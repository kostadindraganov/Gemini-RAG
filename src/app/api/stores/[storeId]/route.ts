import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { deleteStoreDB } from "@/lib/db";

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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string }> }
) {
    try {
        const ai = getGeminiClient();
        const { storeId } = await params;
        const storeName = `fileSearchStores/${storeId}`;
        const store = await ai.fileSearchStores.get({ name: storeName });
        return NextResponse.json({ store });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("404")) {
            return NextResponse.json({ error: "Store not found" }, { status: 404 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ storeId: string }> }
) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const ai = getGeminiClient();
        const { storeId } = await params;
        const storeName = `fileSearchStores/${storeId}`;

        await ai.fileSearchStores.delete({ name: storeName, config: { force: true } });
        await deleteStoreDB(user.id, storeId, user.token);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
