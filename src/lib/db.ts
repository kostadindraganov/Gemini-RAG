import { getSupabaseServer } from "./supabase";
import type { StoreRecord, DocumentRecord, ChatMessage, Citation } from "./state";

// ==================== STORES ====================

export async function getStores(userId: string, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("stores")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        createdAt: row.created_at,
        documentCount: row.document_count,
    })) as StoreRecord[];
}

export async function upsertStore(userId: string, store: StoreRecord, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("stores").upsert({
        id: store.id,
        user_id: userId,
        name: store.name,
        display_name: store.displayName,
        document_count: store.documentCount,
        created_at: store.createdAt,
    }, { onConflict: "id" });
    if (error) throw error;
}

export async function deleteStoreDB(userId: string, storeId: string, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("stores").delete().eq("id", storeId).eq("user_id", userId);
    if (error) throw error;
}

// ==================== DOCUMENTS ====================

export async function getDocuments(userId: string, storeId?: string, accessToken?: string, limit?: number, offset?: number) {
    const sb = getSupabaseServer(accessToken);
    let q = sb.from("documents").select("*", { count: 'exact' }).eq("user_id", userId);
    if (storeId) q = q.eq("store_id", storeId);

    let query = q.order("uploaded_at", { ascending: false });

    if (typeof limit === 'number') {
        const from = offset || 0;
        const to = from + limit - 1;
        query = query.range(from, to);
    }

    const { data, count, error } = await query;
    if (error) throw error;
    return {
        documents: (data || []).map(row => ({
            id: row.id,
            storeId: row.store_id,
            name: row.name,
            displayName: row.display_name,
            originalFilename: row.original_filename,
            mimeType: row.mime_type,
            size: row.size,
            uploadedAt: row.uploaded_at,
            localPath: row.local_path,
            metadata: row.metadata,
        })),
        totalCount: count || 0
    };
}

export async function getDocument(userId: string, docId: string, accessToken?: string): Promise<DocumentRecord | null> {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("documents")
        .select("*")
        .eq("user_id", userId)
        .eq("id", docId)
        .single();
    if (error) return null;
    return {
        id: data.id,
        storeId: data.store_id,
        name: data.name,
        displayName: data.display_name,
        originalFilename: data.original_filename,
        mimeType: data.mime_type,
        size: data.size,
        uploadedAt: data.uploaded_at,
        localPath: data.local_path,
        metadata: data.metadata,
    };
}

/** Like getDocument, but uses the service role key to bypass RLS. */
export async function getDocumentAdmin(userId: string, docId: string): Promise<DocumentRecord | null> {
    const { getSupabaseAdmin } = await import("./supabase");
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
        .from("documents")
        .select("*")
        .eq("user_id", userId)
        .eq("id", docId)
        .single();
    if (error) return null;
    return {
        id: data.id,
        storeId: data.store_id,
        name: data.name,
        displayName: data.display_name,
        originalFilename: data.original_filename,
        mimeType: data.mime_type,
        size: data.size,
        uploadedAt: data.uploaded_at,
        localPath: data.local_path,
        metadata: data.metadata,
    };
}

export async function insertDocument(userId: string, doc: DocumentRecord, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("documents").insert({
        id: doc.id,
        user_id: userId,
        store_id: doc.storeId,
        name: doc.name,
        display_name: doc.displayName,
        original_filename: doc.originalFilename,
        mime_type: doc.mimeType,
        size: doc.size,
        local_path: doc.localPath,
        metadata: doc.metadata || {},
        uploaded_at: doc.uploadedAt,
    });
    if (error) throw error;
}

export async function deleteDocumentDB(userId: string, docId: string, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("documents").delete().eq("id", docId).eq("user_id", userId);
    if (error) throw error;
}

// ==================== CHAT MESSAGES ====================

export async function getChatHistory(userId: string, limit = 100, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("chat_messages")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(limit);
    if (error) throw error;
    return (data || []).map(row => ({
        id: row.id,
        role: row.role as "user" | "model",
        content: row.content,
        citations: row.citations || undefined,
        timestamp: row.created_at,
    })) as ChatMessage[];
}

export async function addChatMessages(userId: string, messages: ChatMessage[], accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const rows = messages.map(m => ({
        id: m.id,
        user_id: userId,
        role: m.role,
        content: m.content,
        citations: m.citations || [],
        created_at: m.timestamp,
    }));
    const { error } = await sb.from("chat_messages").insert(rows);
    if (error) throw error;
}

export async function clearChatHistory(userId: string, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("chat_messages").delete().eq("user_id", userId);
    if (error) throw error;
}

// ==================== USER SETTINGS ====================

export interface UserSettings {
    systemPrompt: string;
    activeStoreId: string | null;
    activeModel: string;
    mcpApiKey: string;
    totalTokens: number;
    estimatedCost: number;
    chunkingMaxTokens: number;
    chunkingMaxOverlap: number;
    accountTier: string;
}

export async function getUserSettings(userId: string, accessToken?: string): Promise<UserSettings> {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("user_settings")
        .select("*")
        .eq("user_id", userId)
        .single();

    if (error && error.code === "PGRST116") {
        // Row not found — create default
        await sb.from("user_settings").insert({ user_id: userId });
        return getDefaultSettings();
    }
    if (error) throw error;

    return {
        systemPrompt: data.system_prompt,
        activeStoreId: data.active_store_id,
        activeModel: data.active_model,
        mcpApiKey: data.mcp_api_key || "",
        totalTokens: data.total_tokens || 0,
        estimatedCost: parseFloat(data.estimated_cost) || 0,
        chunkingMaxTokens: data.chunking_max_tokens || 512,
        chunkingMaxOverlap: data.chunking_max_overlap || 50,
        accountTier: data.account_tier || 'free',
    };
}

export async function updateUserSettings(userId: string, updates: Partial<Record<string, any>>, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const row: Record<string, any> = { updated_at: new Date().toISOString() };

    if (updates.systemPrompt !== undefined) row.system_prompt = updates.systemPrompt;
    if (updates.activeStoreId !== undefined) row.active_store_id = updates.activeStoreId;
    if (updates.activeModel !== undefined) row.active_model = updates.activeModel;
    if (updates.mcpConfig?.apiKey !== undefined) row.mcp_api_key = updates.mcpConfig.apiKey;
    if (updates.totalTokens !== undefined) row.total_tokens = updates.totalTokens;
    if (updates.estimatedCost !== undefined) row.estimated_cost = updates.estimatedCost;
    if (updates.chunkingConfig?.maxTokensPerChunk !== undefined) row.chunking_max_tokens = updates.chunkingConfig.maxTokensPerChunk;
    if (updates.chunkingConfig?.maxOverlapTokens !== undefined) row.chunking_max_overlap = updates.chunkingConfig.maxOverlapTokens;
    if (updates.accountTier !== undefined) row.account_tier = updates.accountTier;

    const { error } = await sb.from("user_settings").update(row).eq("user_id", userId);
    if (error) throw error;
}

export async function incrementUsage(userId: string, tokens: number, cost: number, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    // Use RPC or read-then-write
    const settings = await getUserSettings(userId, accessToken);
    await updateUserSettings(userId, {
        totalTokens: settings.totalTokens + tokens,
        estimatedCost: settings.estimatedCost + cost,
    }, accessToken);
}

function getDefaultSettings(): UserSettings {
    return {
        systemPrompt: "You are a helpful AI assistant. Answer questions based on the provided documents. Always cite your sources when possible. Format your responses using Markdown.",
        activeStoreId: null,
        activeModel: "gemini-2.5-pro",
        mcpApiKey: "",
        totalTokens: 0,
        estimatedCost: 0,
        chunkingMaxTokens: 512,
        chunkingMaxOverlap: 50,
        accountTier: "free"
    };
}

// ==================== MCP API KEYS ====================

export interface McpApiKey {
    id: string;
    userId: string;
    keyValue: string;
    label: string;
    isActive: boolean;
    createdAt: string;
    lastUsedAt: string | null;
}

export async function getMcpApiKeys(userId: string, accessToken?: string): Promise<McpApiKey[]> {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("mcp_api_keys")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
        id: row.id,
        userId: row.user_id,
        keyValue: row.key_value,
        label: row.label,
        isActive: row.is_active,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
    }));
}

export async function createMcpApiKey(userId: string, key: { id: string; keyValue: string; label: string }, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("mcp_api_keys").insert({
        id: key.id,
        user_id: userId,
        key_value: key.keyValue,
        label: key.label,
        is_active: true,
    });
    if (error) throw error;
}

export async function deleteMcpApiKey(userId: string, keyId: string, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("mcp_api_keys").delete().eq("id", keyId).eq("user_id", userId);
    if (error) throw error;
}

export async function toggleMcpApiKey(userId: string, keyId: string, isActive: boolean, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("mcp_api_keys").update({ is_active: isActive }).eq("id", keyId).eq("user_id", userId);
    if (error) throw error;
}

// ==================== MCP ENDPOINTS ====================

export interface McpEndpoint {
    id: string;
    userId: string;
    url: string;
    isActive: boolean;
    createdAt: string;
}

export async function getMcpEndpoints(userId: string, accessToken?: string): Promise<McpEndpoint[]> {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("mcp_endpoints")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
    if (error) return []; // Gracefully fail if table doesn't exist yet
    return (data || []).map(row => ({
        id: row.id,
        userId: row.user_id,
        url: row.url,
        isActive: row.is_active,
        createdAt: row.created_at,
    }));
}

export async function createMcpEndpoint(userId: string, endpoint: { id: string; url: string }, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);

    // De-activate all others first
    await sb.from("mcp_endpoints").update({ is_active: false }).eq("user_id", userId);

    const { error } = await sb.from("mcp_endpoints").insert({
        id: endpoint.id,
        user_id: userId,
        url: endpoint.url,
        is_active: true,
    });
    if (error) throw error;
}

export async function deleteMcpEndpoint(userId: string, endpointId: string, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb.from("mcp_endpoints").delete().eq("id", endpointId).eq("user_id", userId);
    if (error) throw error;
}

export async function toggleMcpEndpoint(userId: string, endpointId: string, isActive: boolean, accessToken?: string) {
    const sb = getSupabaseServer(accessToken);

    // Only allow one active at a time
    if (isActive) {
        await sb.from("mcp_endpoints").update({ is_active: false }).eq("user_id", userId);
    }

    const { error } = await sb.from("mcp_endpoints").update({ is_active: isActive }).eq("id", endpointId).eq("user_id", userId);
    if (error) throw error;
}

// Validate a key against all active keys (used by MCP server — no auth needed, uses service-level query)
export async function validateMcpKey(keyValue: string): Promise<boolean> {
    const sb = getSupabaseServer(); // anon key
    const { data, error } = await sb
        .from("mcp_api_keys")
        .select("id, user_id")
        .eq("key_value", keyValue)
        .eq("is_active", true)
        .limit(1);
    if (error || !data || data.length === 0) return false;
    // Update last_used_at
    await sb.from("mcp_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data[0].id);
    return true;
}

// ==================== SYSTEM CONFIG ====================

export async function getRegistrationLock(accessToken?: string): Promise<boolean> {
    const sb = getSupabaseServer(accessToken);
    const { data, error } = await sb
        .from("system_config")
        .select("value")
        .eq("key", "registration_locked")
        .single();

    if (error) {
        console.error("Failed to fetch registration lock", error);
        return false;
    }
    return data.value === true;
}

export async function toggleRegistrationLock(locked: boolean, accessToken: string) {
    const sb = getSupabaseServer(accessToken);
    const { error } = await sb
        .from("system_config")
        .update({ value: locked, updated_at: new Date().toISOString() })
        .eq("key", "registration_locked");
    if (error) throw error;
}

export async function getUserCount(): Promise<number> {
    const sb = getSupabaseServer(); // Use anon key, calling a security definer function
    const { data, error } = await sb.rpc("get_registered_user_count");

    if (error) {
        console.error("Error fetching user count via RPC", error);
        return 0;
    }
    return data?.[0]?.count || 0;
}

// ==================== HELPER: Get auth user from request ====================

export async function getAuthUser(req: Request) {
    const authHeader = req.headers.get("authorization");
    let token = "";

    if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.replace("Bearer ", "");
    } else {
        // Check query params
        const url = new URL(req.url);
        token = url.searchParams.get("token") || "";
    }

    if (!token) return null;

    const sb = getSupabaseServer(token);
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) return null;
    return { id: user.id, email: user.email, accessToken: token };
}

// Alternative: get user from cookie-based session (for browser requests)
export async function getAuthUserFromCookie(cookieHeader: string | null) {
    if (!cookieHeader) return null;
    const sb = getSupabaseServer();

    const cookies = Object.fromEntries(
        cookieHeader.split(";").map(c => {
            const [k, ...v] = c.trim().split("=");
            return [k, v.join("=")];
        })
    );

    // Parse any cookie matching sb-[ref]-auth-token
    const authCookieName = Object.keys(cookies).find(name =>
        name === "sb-access-token" || (name.startsWith("sb-") && name.endsWith("-auth-token"))
    );

    const accessToken = authCookieName ? cookies[authCookieName] : null;

    if (!accessToken) {
        console.warn("Auth: No Supabase auth cookie found in request headers");
        return null;
    }

    try {
        const parsed = JSON.parse(decodeURIComponent(accessToken));
        const token = parsed?.access_token || parsed?.[0]?.access_token;
        if (!token) return null;
        const sbAuth = getSupabaseServer(token);
        const { data: { user }, error } = await sbAuth.auth.getUser();
        if (error || !user) return null;
        return { id: user.id, email: user.email, accessToken: token };
    } catch {
        return null;
    }
}
