import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/db";
import { getAuthUser, getAuthUserFromCookie } from "@/lib/db";
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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string; docId: string }> }
) {
    try {
        const user = (await getAuthUser(req)) || (await getAuthUserFromCookie(req.headers.get("cookie")));
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { storeId, docId } = await params;

        // Fetch single doc from Supabase
        const doc = await getDocument(user.id, docId, user.accessToken);

        if (!doc) {
            return NextResponse.json({ error: "Document not found in database", docId, storeId }, { status: 404 });
        }

        if (!doc.localPath) {
            return NextResponse.json({ error: "No local file path recorded in database" }, { status: 404 });
        }

        const uploadsDir = getUploadsDirLocal();
        const localPath = path.join(uploadsDir, doc.localPath);

        if (!fs.existsSync(localPath)) {
            // Log it server-side too
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
