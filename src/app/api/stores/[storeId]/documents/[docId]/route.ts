import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { getDocuments, deleteDocumentDB, upsertStore, getStores } from "@/lib/db";
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

function getUploadsDirLocal(): string {
    const DATA_DIR = path.join(process.cwd(), "data");
    const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    return UPLOADS_DIR;
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string; docId: string }> }
) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { storeId, docId } = await params;
        const ai = getGeminiClient();
        const { documents: allDocs } = await getDocuments(user.id, storeId, user.token);
        const docToDelete = allDocs.find(d => d.id === docId && d.storeId === storeId);

        if (docToDelete && docToDelete.name) {
            try {
                await ai.fileSearchStores.documents.delete({ name: docToDelete.name });
            } catch (e: any) {
                if (!e.message?.includes("404")) throw e;
            }
        }

        if (docToDelete?.localPath) {
            const localPath = path.join(getUploadsDirLocal(), docToDelete.localPath);
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
            }
        }

        await deleteDocumentDB(user.id, docId, user.token);

        // Update store document count
        const stores = await getStores(user.id, user.token);
        const store = stores.find(s => s.id === storeId);
        if (store) {
            await upsertStore(user.id, { ...store, documentCount: Math.max(0, store.documentCount - 1) }, user.token);
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
