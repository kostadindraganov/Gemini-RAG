import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getMcpApiKeys, McpApiKey } from "@/lib/db";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3001";

async function getAuthenticatedKey(req: NextRequest): Promise<string | null> {
    const authHeader = req.headers.get("authorization");
    const cookieHeader = req.headers.get("cookie");

    let supabaseToken: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
        supabaseToken = authHeader.slice(7).trim();
    } else if (cookieHeader) {
        const cookies = Object.fromEntries(
            cookieHeader.split(";").map(c => {
                const [k, ...v] = c.trim().split("=");
                return [k, v.join("=")];
            })
        );
        for (const [key, value] of Object.entries(cookies)) {
            if (key.includes("auth-token") || key.includes("access-token")) {
                try {
                    const parsed = JSON.parse(decodeURIComponent(value));
                    const token = parsed?.access_token || (Array.isArray(parsed) ? parsed[0]?.access_token : null);
                    if (token) { supabaseToken = token; break; }
                } catch { /* ignore */ }
            }
        }
    }

    if (!supabaseToken) return null;

    try {
        const sb = getSupabaseServer(supabaseToken);
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return null;

        const keys = await getMcpApiKeys(user.id, supabaseToken);
        const activeKey = (keys || []).find((k: McpApiKey) => k.isActive !== false);
        return activeKey?.keyValue || null;
    } catch {
        return null;
    }
}

// GET /api/mcp-status — proxy to MCP server with auth
export async function GET(req: NextRequest) {
    const mcpKey = await getAuthenticatedKey(req);

    if (!mcpKey) {
        // Return empty status rather than error — the UI can handle no data gracefully
        return NextResponse.json({ sessions: [], history: [], logs: [], status: "unauthenticated" });
    }

    try {
        const res = await fetch(`${MCP_SERVER_URL}/api/mcp-status`, {
            headers: { Authorization: `Bearer ${mcpKey}` },
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error(`[mcp-status proxy] MCP server error ${res.status}: ${text}`);
            return NextResponse.json({ sessions: [], history: [], logs: [], status: "error" });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (err) {
        console.error("[mcp-status proxy] Fetch error:", err);
        return NextResponse.json({ sessions: [], history: [], logs: [], status: "offline" });
    }
}
