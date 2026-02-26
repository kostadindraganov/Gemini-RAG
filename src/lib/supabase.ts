import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Browser client (for components)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server client with service role or anon key for API routes
export function getSupabaseServer(accessToken?: string) {
    if (accessToken) {
        return createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        });
    }
    return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Admin client using service role key — bypasses RLS entirely.
 * Use ONLY on the server side, ONLY when the caller has already verified
 * the user's identity (e.g., via MCP API key lookup).
 */
export function getSupabaseAdmin() {
    const key = supabaseServiceKey || supabaseAnonKey;
    return createClient(supabaseUrl, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}
