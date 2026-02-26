import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getDocuments, deleteDocumentDB, upsertStore, getStores, getAuthUser, getAuthUserFromCookie } from "@/lib/db";
import fs from "fs";
import path from "path";

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
        const user = (await getAuthUser(req)) || (await getAuthUserFromCookie(req.headers.get("cookie")));
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { storeId, docId } = await params;
        const token = user.accessToken;

        // 1. Look up the document in Supabase
        const { documents: allDocs } = await getDocuments(user.id, storeId, token);
        const docToDelete = allDocs.find(d => d.id === docId && d.storeId === storeId);

        // 2. Delete from Gemini (if the document has a Gemini resource name)
        if (docToDelete && docToDelete.name) {
            try {
                const ai = getGeminiClient();
                await ai.fileSearchStores.documents.delete({ name: docToDelete.name });
            } catch (e: any) {
                // 404 = already gone from Gemini, that's fine
                if (!e.message?.includes("404")) {
                    console.error(`[DELETE doc] Gemini delete failed for ${docToDelete.name}:`, e.message);
                }
            }
        }

        // 3. Delete local file
        if (docToDelete?.localPath) {
            const localPath = path.join(getUploadsDirLocal(), docToDelete.localPath);
            if (fs.existsSync(localPath)) {
                try { fs.unlinkSync(localPath); } catch (e) {
                    console.error(`[DELETE doc] Failed to delete local file: ${localPath}`, e);
                }
            }
        }

        // 4. Delete from Supabase
        await deleteDocumentDB(user.id, docId, token);

        // 5. Update store document count
        try {
            const stores = await getStores(user.id, token);
            const store = stores.find(s => s.id === storeId);
            if (store) {
                await upsertStore(user.id, { ...store, documentCount: Math.max(0, store.documentCount - 1) }, token);
            }
        } catch (e) {
            console.error("[DELETE doc] Failed to update store count:", e);
            // Non-critical — document is already deleted
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[DELETE doc] Unhandled error:", message, error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
