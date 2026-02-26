import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
