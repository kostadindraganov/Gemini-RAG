import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Public endpoint — the MCP server calls this to validate a Bearer token
// No user auth needed. It checks if the key exists in mcp_api_keys and is active.
export async function POST(req: NextRequest) {
    try {
        const { key } = await req.json();
        if (!key) {
            return NextResponse.json({ valid: false }, { status: 400 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const sb = createClient(supabaseUrl, supabaseAnonKey);

        const { data, error } = await sb
            .from("mcp_api_keys")
            .select("id, user_id")
            .eq("key_value", key)
            .eq("is_active", true)
            .limit(1);

        if (error || !data || data.length === 0) {
            return NextResponse.json({ valid: false });
        }

        // Update last_used_at
        await sb.from("mcp_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data[0].id);

        return NextResponse.json({ valid: true, userId: data[0].user_id });
    } catch (error: unknown) {
        return NextResponse.json({ valid: false }, { status: 500 });
    }
}
