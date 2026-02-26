import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { getSupabaseServer } from "@/lib/supabase";
import { getStores, upsertStore } from "@/lib/db";
import type { StoreRecord } from "@/lib/state";

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

export async function GET(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const ai = getGeminiClient();
        const storesIter = await ai.fileSearchStores.list();
        const storesFromDB = await getStores(user.id, user.token);
        const stores: StoreRecord[] = [];

        for await (const store of storesIter) {
            const existing = storesFromDB.find((s) => s.name === store.name);
            const record: StoreRecord = {
                id: store.name?.replace("fileSearchStores/", "") || "",
                name: store.name || "",
                displayName: store.displayName || "Unnamed Store",
                createdAt: existing?.createdAt || new Date().toISOString(),
                documentCount: existing?.documentCount || 0,
            };
            stores.push(record);
            await upsertStore(user.id, record, user.token);
        }

        return NextResponse.json({ stores });
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

        const { displayName } = await req.json();
        if (!displayName) {
            return NextResponse.json(
                { error: "displayName is required" },
                { status: 400 }
            );
        }

        const ai = getGeminiClient();
        const store = await ai.fileSearchStores.create({
            config: { displayName },
        });

        const record: StoreRecord = {
            id: store.name?.replace("fileSearchStores/", "") || "",
            name: store.name || "",
            displayName: store.displayName || displayName,
            createdAt: new Date().toISOString(),
            documentCount: 0,
        };

        await upsertStore(user.id, record, user.token);

        return NextResponse.json({ store: record }, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
