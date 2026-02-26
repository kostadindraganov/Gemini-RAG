import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { insertDocument, getUserSettings } from "@/lib/db";
import type { DocumentRecord } from "@/lib/state";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";


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

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string }> }
) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { storeId } = await params;
        const storeName = `fileSearchStores/${storeId}`;

        const formData = await req.formData();
        const file = formData.get("file") as File;
        const metadataStr = formData.get("metadata") as string;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        let metadata;
        try {
            if (metadataStr) metadata = JSON.parse(metadataStr);
        } catch {
            return NextResponse.json({ error: "Invalid metadata JSON" }, { status: 400 });
        }

        // Save to local fs
        const uploadsDir = getUploadsDirLocal();
        const id = uuidv4();
        // Use an ASCII-only local filename because the Gemini SDK uses the 
        // local file basename to set HTTP headers, which crash on non-ASCII characters.
        const localFilename = `${id}${path.extname(file.name)}`;
        const localPath = path.join(uploadsDir, localFilename);
        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(localPath, buffer);

        // Gemini API only accepts ASCII (Latin-1) in displayName.
        // Encode non-ASCII filenames (e.g. Cyrillic, Chinese) via encodeURIComponent
        // so every character is within the 0-127 range. The original name is
        // preserved in our DB record (displayName / originalFilename fields).
        const safeDisplayName = file.name.split('').some(c => c.charCodeAt(0) > 127)
            ? encodeURIComponent(file.name)
            : file.name;

        const ai = getGeminiClient();
        const settings = await getUserSettings(user.id, user.token);

        // Determine mime type — always use our own map to avoid bad values sent
        // by the browser (e.g. empty string or wrong type for .docx)
        const ext = path.extname(file.name).toLowerCase();

        const EXT_TO_MIME: Record<string, string> = {
            // Application types supported by Google File Search
            '.pdf': 'application/pdf',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.doc': 'application/msword',
            '.xls': 'application/vnd.ms-excel',
            '.odt': 'application/vnd.oasis.opendocument.text',
            '.zip': 'application/zip',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.sql': 'application/sql',
            '.dart': 'application/dart',
            '.ts': 'application/typescript',
            '.php': 'application/x-php',
            '.sh': 'application/x-sh',
            '.zsh': 'application/x-zsh',
            '.csh': 'application/x-csh',
            '.ps1': 'application/x-powershell',
            '.tex': 'application/x-tex',
            '.latex': 'application/x-latex',
            // Text types
            '.txt': 'text/plain',
            '.md': 'text/plain',
            '.csv': 'text/csv',
            '.html': 'text/html',
            '.htm': 'text/html',
            '.css': 'text/css',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.js': 'text/plain',
            '.jsx': 'text/plain',
            '.tsx': 'text/plain',
            '.py': 'text/x-python',
            '.java': 'text/x-java',
            '.c': 'text/x-c',
            '.cpp': 'text/x-c++src',
            '.cs': 'text/x-csharp',
            '.go': 'text/x-go',
            '.rs': 'text/x-rust',
            '.rb': 'text/x-ruby-script',
            '.kt': 'text/x-kotlin',
            '.swift': 'text/x-swift',
            '.scala': 'text/x-scala',
            '.r': 'text/x-rsrc',
            '.lua': 'text/x-lua',
            '.pl': 'text/x-perl',
            '.rtf': 'text/rtf',
            '.rst': 'text/x-rst',
            // Images (processed natively via ai.files.upload)
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.heic': 'image/heic',
            '.heif': 'image/heif',
        };

        // Always prefer our explicit map. Fall back to browser type ONLY if it
        // looks like a valid type/subtype string — never pass an empty string.
        let mimeType = EXT_TO_MIME[ext]
            || (file.type && /^[\w-]+\/[\w.+\-]+$/.test(file.type) ? file.type : 'text/plain');

        const isImage = mimeType.startsWith('image/');

        let finalDocumentName = `fileSearchStores/${storeId}/documents/${id}`; // default fallback

        if (isImage) {
            // Images cannot go into FileSearchStores natively, they must be uploaded as regular Gemini Files
            const uploadRes = await ai.files.upload({
                file: localPath,
                config: {
                    mimeType,
                    displayName: safeDisplayName
                }
            });
            finalDocumentName = uploadRes.name || finalDocumentName;

            // Save the unique full URI needed for inline image injection in chat
            if (uploadRes.uri) {
                metadata = { ...(metadata || {}), uri: uploadRes.uri };
            }
            await new Promise(r => setTimeout(r, 1000));
        } else {
            // Upload to File Search Store
            // NOTE: Do NOT pass mimeType inside config — the API rejects many valid
            // MIME strings with INVALID_ARGUMENT. Let the API auto-detect from the
            // file bytes. We still track mimeType in our own DB record.
            const config: any = {
                displayName: safeDisplayName,
            };

            if (metadata && Object.keys(metadata).length > 0) {
                config.customMetadata = Object.entries(metadata).map(([key, value]) => {
                    if (typeof value === 'number') {
                        return { key, numericValue: value };
                    }
                    return { key, stringValue: String(value) };
                });
            }

            if (settings.chunkingMaxTokens) {
                config.chunkingConfig = {
                    whiteSpaceConfig: {
                        maxTokensPerChunk: settings.chunkingMaxTokens,
                        maxOverlapTokens: settings.chunkingMaxOverlap,
                    }
                };
            }

            let operation = await ai.fileSearchStores.uploadToFileSearchStore({
                file: localPath,
                fileSearchStoreName: storeName,
                config
            });

            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                operation = await ai.operations.get({ operation });
            }

            if (operation.error) {
                fs.unlinkSync(localPath);
                return NextResponse.json({ error: operation.error.message || JSON.stringify(operation.error) }, { status: 500 });
            }

            finalDocumentName = operation.response?.documentName || finalDocumentName;
            await new Promise(r => setTimeout(r, 1000));
        }

        const record: DocumentRecord = {
            id,
            storeId,
            name: finalDocumentName,
            displayName: file.name,
            originalFilename: file.name,
            mimeType,
            size: buffer.length,
            uploadedAt: new Date().toISOString(),
            localPath: localFilename,
            metadata
        };

        await insertDocument(user.id, record, user.token);

        // Update store document count
        const { upsertStore, getStores } = await import("@/lib/db");
        const stores = await getStores(user.id, user.token);
        const store = stores.find(s => s.id === storeId);
        if (store) {
            await upsertStore(user.id, { ...store, documentCount: store.documentCount + 1 }, user.token);
        }

        return NextResponse.json({ document: record }, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function getUploadsDirLocal(): string {
    const DATA_DIR = path.join(process.cwd(), "data");
    const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    return UPLOADS_DIR;
}
