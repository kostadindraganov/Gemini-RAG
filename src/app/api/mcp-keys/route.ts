import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getMcpApiKeys, createMcpApiKey, deleteMcpApiKey, toggleMcpApiKey } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

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

// GET - List all MCP API keys for the user
export async function GET(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const keys = await getMcpApiKeys(user.id, user.token);
        return NextResponse.json({ keys });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// POST - Create a new MCP API key
export async function POST(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { label } = await req.json();
        const id = uuidv4();
        const keyValue = "sk-" + uuidv4().replace(/-/g, "");

        await createMcpApiKey(user.id, { id, keyValue, label: label || "API Key" }, user.token);

        const keys = await getMcpApiKeys(user.id, user.token);
        return NextResponse.json({ key: { id, keyValue, label: label || "API Key" }, keys }, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// DELETE - Delete a specific MCP API key
export async function DELETE(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { keyId } = await req.json();
        if (!keyId) return NextResponse.json({ error: "keyId is required" }, { status: 400 });

        await deleteMcpApiKey(user.id, keyId, user.token);
        const keys = await getMcpApiKeys(user.id, user.token);
        return NextResponse.json({ success: true, keys });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// PATCH - Toggle a key active/inactive
export async function PATCH(req: NextRequest) {
    try {
        const user = await getUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { keyId, isActive } = await req.json();
        if (!keyId || isActive === undefined) return NextResponse.json({ error: "keyId and isActive required" }, { status: 400 });

        await toggleMcpApiKey(user.id, keyId, isActive, user.token);
        const keys = await getMcpApiKeys(user.id, user.token);
        return NextResponse.json({ success: true, keys });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
