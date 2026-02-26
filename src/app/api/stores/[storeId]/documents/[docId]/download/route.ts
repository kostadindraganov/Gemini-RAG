import { NextRequest, NextResponse } from "next/server";
import { loadState, getUploadsDir } from "@/lib/state";
import path from "path";
import fs from "fs";
import { Readable } from 'stream';

function streamToResponse(stream: fs.ReadStream, contentType: string, filename: string) {
    // @ts-ignore - NextResponse handles ReadableStream or node streams in latest next
    return new NextResponse(stream as any, {
        headers: {
            "Content-Type": contentType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`
        }
    });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string; docId: string }> }
) {
    try {
        const { storeId, docId } = await params;
        const state = loadState();
        const doc = state.documents.find(d => d.id === docId && d.storeId === storeId);

        if (!doc || !doc.localPath) {
            return NextResponse.json({ error: "Document not found locally" }, { status: 404 });
        }

        const localPath = path.join(getUploadsDir(), doc.localPath);
        if (!fs.existsSync(localPath)) {
            return NextResponse.json({ error: "File not on disk" }, { status: 404 });
        }

        const stream = fs.createReadStream(localPath);
        return streamToResponse(stream, doc.mimeType, doc.originalFilename);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
