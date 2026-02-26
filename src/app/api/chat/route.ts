import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { getUserSettings, getStores, getDocuments, getChatHistory, addChatMessages, incrementUsage } from "@/lib/db";
import type { ChatMessage, Citation } from "@/lib/state";
import { v4 as uuidv4 } from "uuid";

async function getUser(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    const cookieHeader = req.headers.get("cookie");
    if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const sb = getSupabaseServer(token);
        const { data: { user } } = await sb.auth.getUser();
        if (user) return { id: user.id, token };
    }
    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split(";").map(c => { const [k, ...v] = c.trim().split("="); return [k, v.join("=")]; })
        );
        for (const [key, value] of Object.entries(cookies)) {
            if (key.includes("auth-token") || key.includes("access-token")) {
                try {
                    const parsed = JSON.parse(decodeURIComponent(value));
                    const token = parsed?.access_token || (Array.isArray(parsed) ? parsed[0]?.access_token : null);
                    if (token) {
                        const sb = getSupabaseServer(token);
                        const { data: { user } } = await sb.auth.getUser();
                        if (user) return { id: user.id, token };
                    }
                } catch { /* ignore */ }
            }
        }
    }
    return null;
}

export async function POST(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { message, storeIds, systemPrompt } = await req.json();
        if (!message) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }

        const ai = getGeminiClient();
        const settings = await getUserSettings(user.id, user.token);
        const stores = await getStores(user.id, user.token);
        const { documents: allDocs } = await getDocuments(user.id, undefined, user.token);

        // Process stores
        const activeStores = storeIds
            ? stores.filter(s => storeIds.includes(s.id))
            : [];

        // All actual File Search Stores string bindings
        const fileSearchStoreNames = activeStores.map(s => `fileSearchStores/${s.id}`);
        const storeDocs = activeStores.length > 0 ? allDocs.filter(d => activeStores.some(s => s.id === d.storeId)) : [];
        const imageDocs = storeDocs.filter(d => d.mimeType.startsWith("image/"));
        const textDocs = storeDocs.filter(d => !d.mimeType.startsWith("image/"));

        // Set up configuration
        let enhancedSystemPrompt = systemPrompt || settings.systemPrompt;

        if (activeStores.length > 0) {
            const docNames = textDocs.map(d => d.displayName || d.originalFilename);
            const imgNames = imageDocs.map(d => d.displayName || d.originalFilename);

            let contextString = `\n\n[SYSTEM CONTEXT]: You are currently searching across ${activeStores.length} file store(s) containing a total of ${storeDocs.length} document(s). `;
            if (docNames.length > 0) contextString += `\nThe text documents available in this search are: ${docNames.join(", ")}.`;
            if (imgNames.length > 0) contextString += `\nThere are also ${imgNames.length} image(s) provided directly into your visual context: ${imgNames.join(", ")}.`;

            enhancedSystemPrompt += contextString;
        }

        const config: any = {
            systemInstruction: enhancedSystemPrompt,
        };

        if (fileSearchStoreNames.length > 0) {
            config.tools = [
                {
                    fileSearch: {
                        fileSearchStoreNames: fileSearchStoreNames
                    }
                }
            ];
        }

        const chatHistory = await getChatHistory(user.id, 10, user.token);

        const userParts: any[] = [{ text: message }];

        // Push actual image bytes to the prompt to let the model "see" them 
        for (const doc of imageDocs) {
            const fileUri = (doc.metadata as any)?.uri;
            if (fileUri) {
                userParts.unshift({
                    fileData: {
                        mimeType: doc.mimeType,
                        fileUri: fileUri
                    }
                });
            }
        }

        const contents = [
            ...chatHistory.slice(-10).map(h => ({
                role: h.role,
                parts: [{ text: h.content }]
            })),
            { role: "user", parts: userParts }
        ];

        const response = await ai.models.generateContent({
            model: settings.activeModel || GEMINI_MODEL,
            // @ts-ignore SDK type matching
            contents,
            config
        });

        const responseText = response.text || "";

        // Extract metadata/citations
        const citations: Citation[] = [];
        const seenTitles = new Set<string>();

        if (response.candidates?.[0]?.groundingMetadata) {
            const grounding = response.candidates[0].groundingMetadata;
            if (grounding.groundingChunks) {
                grounding.groundingChunks.forEach(chunk => {
                    const title = chunk.retrievedContext?.title || chunk.web?.title || "Document Source";
                    if (!seenTitles.has(title)) {
                        seenTitles.add(title);
                        const doc = allDocs.find(d => d.displayName === title || d.originalFilename === title);
                        citations.push({
                            title: title,
                            chunk: chunk.retrievedContext?.text || chunk.web?.uri || "",
                            // @ts-ignore
                            uri: doc ? `/api/stores/${doc.storeId}/documents/${doc.id}/download` : undefined
                        });
                    }
                });
            }
        }

        const userMessage: ChatMessage = {
            id: uuidv4(),
            role: "user",
            content: message,
            timestamp: new Date().toISOString()
        };

        const assistantMessage: ChatMessage = {
            id: uuidv4(),
            role: "model",
            content: responseText,
            citations: citations.length > 0 ? citations : undefined,
            timestamp: new Date().toISOString()
        };

        // Extract usage stats
        let promptTokens = 0;
        let candidateTokens = 0;
        if (response.usageMetadata) {
            promptTokens = response.usageMetadata.promptTokenCount || 0;
            candidateTokens = response.usageMetadata.candidatesTokenCount || 0;
        }
        const cost = (promptTokens * 0.000000075) + (candidateTokens * 0.0000003);
        const newTokens = promptTokens + candidateTokens;

        // Save to Supabase
        await addChatMessages(user.id, [userMessage, assistantMessage], user.token);
        await incrementUsage(user.id, newTokens, cost, user.token);

        if (systemPrompt && systemPrompt !== settings.systemPrompt) {
            const { updateUserSettings } = await import("@/lib/db");
            await updateUserSettings(user.id, { systemPrompt }, user.token);
        }

        const fullHistory = await getChatHistory(user.id, 100, user.token);

        return NextResponse.json({
            message: assistantMessage,
            history: fullHistory
        });
    } catch (error: any) {
        console.error("Chat API error:", error);

        // Handle Gemini Quota Exceeded Error
        const errorMessage = error?.message?.toLowerCase() || "";
        const errorStatus = error?.status;
        if (errorStatus === 429 || errorMessage.includes("429") || errorMessage.includes("quota")) {
            return NextResponse.json({
                error: "QUOTA_EXCEEDED",
                message: "You exceeded your current quota. Free tier allows 15 Requests Per Minute (RPM) and 1 Million Tokens Per Minute (TPM). Please wait a moment and try again."
            }, { status: 429 });
        }

        const msg = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
