import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { getDocuments } from "@/lib/db";

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
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { storeId } = await params;
        const ai = getGeminiClient();

        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get("page") || "1", 10);
        const limit = parseInt(url.searchParams.get("limit") || "20", 10);
        const offset = (page - 1) * limit;

        const { documents: storedDocuments, totalCount } = await getDocuments(user.id, storeId, user.token, limit, offset);

        // We aren't doing the very slow full API list sync anymore (for pagination performance)
        // just relying on DB items, because otherwise API list doesn't match perfectly with offset

        return NextResponse.json({
            storedDocuments,
            totalCount,
            page,
            limit,
            hasMore: offset + limit < totalCount
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
