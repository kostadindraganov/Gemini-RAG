import { NextRequest, NextResponse } from "next/server";
import { getDocument, getDocumentAdmin } from "@/lib/db";
import { getAuthUser, getAuthUserFromCookie } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase";
import path from "path";
import fs from "fs";

function streamToResponse(stream: fs.ReadStream, contentType: string, filename: string) {
    // @ts-ignore - NextResponse handles ReadableStream or node streams in latest next
    return new NextResponse(stream as any, {
        headers: {
            "Content-Type": contentType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`
        }
    });
}

function getUploadsDirLocal(): string {
    const DATA_DIR = path.join(process.cwd(), "data");
    const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    return UPLOADS_DIR;
}

/**
 * Tries to resolve a userId from an MCP API key.
 * Used as a fallback when the token is not a valid Supabase JWT.
 * MCP-generated download links use the MCP key as the ?token= param.
 */
async function getUserFromMcpKey(token: string): Promise<{ id: string } | null> {
    if (!token) return null;
    const sb = getSupabaseAdmin(); // uses service role key to bypass RLS
    const { data, error } = await sb
        .from("mcp_api_keys")
        .select("user_id")
        .eq("key_value", token)
        .eq("is_active", true)
        .limit(1)
        .single();

    if (error || !data) return null;

    // fire-and-forget last_used update
    void sb.from("mcp_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("key_value", token);

    return { id: data.user_id };
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string; docId: string }> }
) {
    try {
        // 1. Try normal Supabase JWT auth (Bearer header or ?token= query param)
        let userId: string | null = null;
        let accessToken: string | undefined;
        let useAdmin = false;
        let authMethod = "none";

        const jwtUser = (await getAuthUser(req)) || (await getAuthUserFromCookie(req.headers.get("cookie")));
        if (jwtUser) {
            userId = jwtUser.id;
            accessToken = jwtUser.accessToken;
            authMethod = "jwt";
        }

        // 2. Fallback: accept MCP API key as ?token= or Bearer header.
        //    MCP-generated download links carry the MCP key, not a Supabase JWT.
        if (!userId) {
            const url = new URL(req.url);
            const rawToken =
                req.headers.get("authorization")?.replace("Bearer ", "") ||
                url.searchParams.get("token") || "";

            const mcpUser = await getUserFromMcpKey(rawToken);
            if (mcpUser) {
                userId = mcpUser.id;
                useAdmin = true; // No Supabase JWT — use admin client for document query
                authMethod = "mcp-key";
            }
        }

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { storeId, docId } = await params;

        console.log(`[Download] auth=${authMethod} userId=${userId} docId=${docId} storeId=${storeId} useAdmin=${useAdmin} hasServiceKey=${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);

        // Use admin client for MCP-key auth (bypasses RLS), JWT client otherwise
        const doc = useAdmin
            ? await getDocumentAdmin(userId, docId)
            : await getDocument(userId, docId, accessToken);

        if (!doc) {
            console.error(`[Download] Document not found: userId=${userId} docId=${docId} auth=${authMethod} useAdmin=${useAdmin}`);
            return NextResponse.json({
                error: "Document not found in database",
                docId,
                storeId,
                authMethod,
                hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            }, { status: 404 });
        }

        if (!doc.localPath) {
            return NextResponse.json({ error: "No local file path recorded in database" }, { status: 404 });
        }

        const uploadsDir = getUploadsDirLocal();
        const localPath = path.join(uploadsDir, doc.localPath);

        if (!fs.existsSync(localPath)) {
            console.error(`[Download] File not found on disk: ${localPath}`);
            return NextResponse.json({
                error: "File not on disk",
                path: localPath,
                filename: doc.localPath,
                cwd: process.cwd()
            }, { status: 404 });
        }

        const stream = fs.createReadStream(localPath);
        return streamToResponse(stream, doc.mimeType, doc.originalFilename);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
