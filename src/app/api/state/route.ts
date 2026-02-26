import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getStores, getDocuments, getChatHistory, getUserSettings, updateUserSettings, clearChatHistory } from "@/lib/db";

async function getUser(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    const cookieHeader = req.headers.get("cookie");

    // Try Authorization header first
    if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const sb = getSupabaseServer(token);
        const { data: { user } } = await sb.auth.getUser();
        if (user) return { id: user.id, token };
    }

    // Try cookie-based session
    if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split(";").map(c => {
                const [k, ...v] = c.trim().split("=");
                return [k, v.join("=")];
            })
        );
        // Supabase stores tokens in cookies with project ref
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

export async function GET(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [stores, { documents }, chatHistory, settings] = await Promise.all([
            getStores(user.id, user.token),
            getDocuments(user.id, undefined, user.token),
            getChatHistory(user.id, 100, user.token),
            getUserSettings(user.id, user.token),
        ]);

        const storesWithSize = stores.map(store => {
            const storeDocs = documents.filter(d => d.storeId === store.id);
            const totalSize = storeDocs.reduce((acc, doc) => acc + (doc.size || 0), 0);
            return { ...store, totalSize };
        });

        return NextResponse.json({
            stores: storesWithSize,
            documents,
            chatHistory,
            systemPrompt: settings.systemPrompt,
            activeStoreId: settings.activeStoreId,
            activeModel: settings.activeModel,
            mcpConfig: { apiKey: settings.mcpApiKey },
            usage: { totalTokens: settings.totalTokens, estimatedCost: settings.estimatedCost },
            chunkingConfig: { maxTokensPerChunk: settings.chunkingMaxTokens, maxOverlapTokens: settings.chunkingMaxOverlap },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const updates = await req.json();
        await updateUserSettings(user.id, updates, user.token);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await clearChatHistory(user.id, user.token);
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
