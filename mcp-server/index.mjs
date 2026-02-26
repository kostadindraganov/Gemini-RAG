import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";

// ── Env loading ────────────────────────────────────────────────────────────────
if (fs.existsSync(".env.local")) {
    fs.readFileSync(".env.local", "utf-8").split("\n").forEach(line => {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (m) {
            const k = m[1].trim(), v = m[2].trim().replace(/^['"]|['"]$/g, "");
            if (!process.env[k]) process.env[k] = v;
        }
    });
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://rag.kokoit.com";

// Comma-separated list of allowed CORS origins, or leave empty to allow the APP_URL only.
const ALLOWED_ORIGINS = process.env.MCP_ALLOWED_ORIGINS
    ? process.env.MCP_ALLOWED_ORIGINS.split(",").map(s => s.trim())
    : [APP_URL, "http://localhost:3000", "http://localhost:3001"];

if (!GEMINI_API_KEY) { console.error("[MCP] GEMINI_API_KEY not set"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ── Logging ───────────────────────────────────────────────────────────────────
// Defined early so helpers defined below can use it safely.
const MAX_LOGS = 100;
const mcpLogs = [];
function addMcpLog(msg) {
    const log = { id: Date.now() + Math.random(), time: new Date().toISOString(), message: msg };
    mcpLogs.push(log);
    if (mcpLogs.length > MAX_LOGS) mcpLogs.shift();
    console.log(`[MCP] ${msg}`);
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
/**
 * Safe GET from Supabase REST API using the anon key (RLS applies).
 * params keys that start with a filter operator are passed as-is; plain keys
 * are automatically wrapped in eq.<value>  so callers don't have to.
 */
async function sbFetch(table, params = {}) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return null;
    try {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const res = await fetch(url.toString(), {
            headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${SUPABASE_ANON}`,
                "Accept": "application/json",
            }
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Supabase error: ${res.status} ${err}`);
        }
        return await res.json();
    } catch (e) {
        addMcpLog(`sbFetch error [${table}]: ${e.message}`);
        return null;
    }
}

async function sbPatch(table, filter, body) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return;
    try {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
        Object.entries(filter).forEach(([k, v]) => url.searchParams.set(k, `eq.${v}`));
        await fetch(url.toString(), {
            method: "PATCH",
            headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${SUPABASE_ANON}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body)
        });
    } catch (e) {
        addMcpLog(`sbPatch error [${table}]: ${e.message}`);
    }
}

// ── Auth: validate MCP key → userId ──────────────────────────────────────────
// Simple in-memory token cache: token → { userId, expiresAt }
const authCache = new Map();
const AUTH_CACHE_TTL_MS = 60_000; // 60 s

async function resolveUser(bearerToken) {
    if (!bearerToken) return { userId: null, valid: false };

    // Allow all in no-DB mode (local dev only)
    if (!SUPABASE_URL || !SUPABASE_ANON) {
        return { userId: null, valid: true };
    }

    // ── Cache hit ──
    const cached = authCache.get(bearerToken);
    if (cached && cached.expiresAt > Date.now()) {
        return { userId: cached.userId, valid: true };
    }

    // ── Guard: reject tokens that look structurally wrong to avoid injection ──
    // MCP keys are UUIDs or similar opaque strings; Supabase JWTs start with "eyJ"
    if (bearerToken.startsWith("eyJ")) {
        // This is a Supabase JWT — not valid for MCP auth
        return { userId: null, valid: false };
    }

    const rows = await sbFetch("mcp_api_keys", {
        "key_value": `eq.${encodeURIComponent(bearerToken)}`,
        "is_active": "eq.true",
        "select": "id,user_id",
        "limit": "1",
    });

    if (!rows || rows.length === 0) return { userId: null, valid: false };

    const { id, user_id: userId } = rows[0];

    // Cache the result
    authCache.set(bearerToken, { userId, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

    // Fire-and-forget last_used update
    sbPatch("mcp_api_keys", { id }, { last_used_at: new Date().toISOString() }).catch(() => { });

    return { userId, valid: true };
}

// ── User settings ─────────────────────────────────────────────────────────────
// Per-user settings cache: userId → { data, expiresAt }
const settingsCache = new Map();
const SETTINGS_CACHE_TTL_MS = 30_000; // 30 s

async function getUserSettings(userId) {
    if (!userId) return null;

    const cached = settingsCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const rows = await sbFetch("user_settings", {
        "user_id": `eq.${userId}`,
        "select": "active_store_id,active_model,system_prompt",
        "limit": "1",
    });
    const data = rows?.[0] || null;

    settingsCache.set(userId, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
    return data;
}

function invalidateSettingsCache(userId) {
    settingsCache.delete(userId);
}

async function setActiveStore(userId, storeId) {
    if (!userId || !storeId) return;
    await sbPatch("user_settings", { user_id: userId }, { active_store_id: storeId });
    invalidateSettingsCache(userId);
}

// ── Store helpers (Supabase-backed, fast) ─────────────────────────────────────
// NOTE: We intentionally query the Supabase `stores` table — NOT the Gemini API.
//       The app owns store metadata (display name, etc.) and the Supabase table
//       is the single source of truth. Calling the Gemini API for every tool
//       invocation is orders of magnitude slower.

async function getStoresByUser(userId) {
    const rows = await sbFetch("stores", {
        "user_id": `eq.${userId}`,
        "select": "id,display_name,document_count",
        "order": "created_at.desc",
    });
    return (rows || []).map(r => ({
        id: r.id,
        displayName: r.display_name || r.id,
        documentCount: r.document_count || 0,
    }));
}

async function findStoreByUser(userId, identifier) {
    const stores = await getStoresByUser(userId);
    const q = identifier.toLowerCase();
    return stores.find(s =>
        s.id.toLowerCase() === q ||
        s.displayName.toLowerCase() === q ||
        s.displayName.toLowerCase().includes(q)
    ) || null;
}

function toStoreName(id) {
    return id.startsWith("fileSearchStores/") ? id : `fileSearchStores/${id}`;
}

// ── Document helpers (Supabase-backed) ───────────────────────────────────────
async function getDocumentsByUser(userId, storeId, limit = 100) {
    const params = {
        "user_id": `eq.${userId}`,
        "select": "id,display_name,original_filename,store_id,mime_type",
        "order": "uploaded_at.desc",
        "limit": String(Math.min(limit, 500)),
    };
    if (storeId) params["store_id"] = `eq.${storeId}`;
    return (await sbFetch("documents", params)) || [];
}

// ── Gemini RAG query ──────────────────────────────────────────────────────────
async function ragQuery({ query, storeNames, model = "gemini-2.5-flash", systemPrompt, history = [] }) {
    const config = {
        tools: [{ fileSearch: { fileSearchStoreNames: storeNames } }],
    };
    if (systemPrompt) config.systemInstruction = systemPrompt;

    const contents = [
        ...history,
        { role: "user", parts: [{ text: query }] }
    ];

    const response = await ai.models.generateContent({ model, contents, config });

    let text = response.text || "(No response)";

    // Append citations
    const grounding = response.candidates?.[0]?.groundingMetadata;
    if (grounding?.groundingChunks?.length) {
        text += "\n\nSources:";
        const seen = new Set();
        for (const chunk of grounding.groundingChunks) {
            if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
                text += `\n- ${chunk.web.title || chunk.web.uri} (${chunk.web.uri})`;
                seen.add(chunk.web.uri);
            } else if (chunk.retrievedContext?.uri && !seen.has(chunk.retrievedContext.uri)) {
                const label = chunk.retrievedContext.title || chunk.retrievedContext.uri.split("/").pop();
                text += `\n- ${label}`;
                seen.add(chunk.retrievedContext.uri);
            }
        }
    }

    return text;
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// Restrict CORS to known safe origins
app.use(cors({
    origin: (origin, cb) => {
        // Allow requests with no origin (same-host curl, server-to-server)
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin "${origin}" not allowed`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
}));

// Body parser (needed for POST /sse message bodies)
app.use(express.json({ limit: "1mb" }));

// Session store: sessionId → { transport, server, userId, token, establishedAt }
const sessions = new Map();
const sessionHistory = [];
const MAX_SESSION_HISTORY = 20;

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
    const noisy = ["/", "/api/mcp-status"];
    if (!noisy.includes(req.url)) addMcpLog(`${req.method} ${req.url}`);
    next();
});

app.get("/", (_req, res) => res.send("Gemini RAG MCP Server v2.2 is alive."));

// ── Status endpoint (authenticated) ──────────────────────────────────────────
// Protected: only callers with a valid MCP key can see session/log data.
app.get("/api/mcp-status", auth, (req, res) => {
    const activeSessions = Array.from(sessions.values()).map(s => ({
        sessionId: s.transport?.sessionId,
        userId: s.userId,
        established: s.establishedAt,
    }));
    res.json({
        status: "online",
        version: "2.2.0",
        sessions: activeSessions,
        history: sessionHistory,
        logs: mcpLogs,
    });
});

// Protected: clear logs
app.post("/api/mcp-logs/clear", auth, (_req, res) => {
    mcpLogs.length = 0;
    addMcpLog("Logs cleared.");
    res.json({ success: true });
});

// ── Auth middleware ───────────────────────────────────────────────────────────
async function auth(req, res, next) {
    try {
        let token = "";
        const header = req.headers.authorization;
        if (header?.startsWith("Bearer ")) {
            token = header.slice(7).trim();
        } else if (req.query.token) {
            token = String(req.query.token).trim();
        }

        if (!token) {
            addMcpLog(`${req.method} ${req.url} → 401 No token`);
            return res.status(401).json({ error: "Missing token. Use Bearer header or ?token= query param." });
        }

        const { userId, valid } = await resolveUser(token);
        if (!valid) {
            addMcpLog(`${req.method} ${req.url} → 403 Invalid key`);
            return res.status(403).json({ error: "Invalid or inactive MCP API key." });
        }

        req.userId = userId;
        req.token = token;
        next();
    } catch (e) {
        addMcpLog(`Auth error: ${e.message}`);
        res.status(500).json({ error: "Internal server error during authentication." });
    }
}

// ── Session helpers ───────────────────────────────────────────────────────────
function resolveSessionFromExtra(extra) {
    const sessionId = extra?.transport?.sessionId;
    if (!sessionId) return null;
    return sessions.get(sessionId) || null;
}

function resolveUserIdFromExtra(extra) {
    return resolveSessionFromExtra(extra)?.userId ?? null;
}

// ── Tool registry ─────────────────────────────────────────────────────────────
const tools = [];
function registerTool(name, description, schema, handler) {
    tools.push({ name, description, schema, handler });
}

// Pre-compute JSON schemas once at startup (instead of on every list_tools call)
let _cachedToolSchemas = null;
function getCachedToolSchemas() {
    if (_cachedToolSchemas) return _cachedToolSchemas;
    _cachedToolSchemas = tools.map(t => {
        const zodSchema = t.schema._def ? t.schema : z.object(t.schema);
        const { $schema, definitions, ...cleanSchema } = zodToJsonSchema(zodSchema);
        return { name: t.name, description: t.description, inputSchema: cleanSchema };
    });
    return _cachedToolSchemas;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. chat  ▸ Primary RAG tool
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "chat",
    "Chat with your documents. Ask a question and get an answer grounded in your uploaded files.",
    {
        message: z.string().min(1).describe("Your question or message"),
        storeId: z.string().optional().describe("Store ID to search. Omit to use your active store."),
        model: z.string().optional().describe("Gemini model (default: gemini-2.5-flash)"),
    },
    async ({ message, storeId, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const settings = await getUserSettings(userId);
            const resolvedStoreId = storeId || settings?.active_store_id;
            if (!resolvedStoreId) return err("⚠️ No active store set. Use set_active_store first.");

            // Verify the store belongs to this user
            const store = await findStoreByUser(userId, resolvedStoreId);
            if (!store) return err(`Store "${resolvedStoreId}" not found or not accessible.`);

            const answer = await ragQuery({
                query: message,
                storeNames: [toStoreName(store.id)],
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });
            return ok(answer);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. chat_with_store
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "chat_with_store",
    "Chat with documents in a specific store by its ID or display name.",
    {
        message: z.string().min(1).describe("Your question or message"),
        storeId: z.string().describe("Store ID or display name"),
        model: z.string().optional().describe("Gemini model"),
    },
    async ({ message, storeId, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const store = await findStoreByUser(userId, storeId);
            if (!store) return err(`Store "${storeId}" not found.`);

            const settings = await getUserSettings(userId);
            const answer = await ragQuery({
                query: message,
                storeNames: [toStoreName(store.id)],
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });
            return ok(answer);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. chat_all_stores
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "chat_all_stores",
    "Ask a question and search across ALL of your document stores simultaneously.",
    {
        message: z.string().min(1).describe("Your question or message"),
        model: z.string().optional().describe("Gemini model"),
    },
    async ({ message, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const stores = await getStoresByUser(userId);
            if (!stores.length) return err("No stores found. Create a store and upload files first.");

            const settings = await getUserSettings(userId);
            const answer = await ragQuery({
                query: message,
                storeNames: stores.map(s => toStoreName(s.id)),
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });
            return ok(answer);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. list_stores
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "list_stores",
    "List all your document stores with their IDs and document counts.",
    {},
    async (_, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const [stores, settings] = await Promise.all([
                getStoresByUser(userId),
                getUserSettings(userId),
            ]);
            if (!stores.length) return ok("No stores found. Create a store in the web UI first.");

            const activeId = settings?.active_store_id;
            const lines = stores.map(s =>
                `${s.id === activeId ? "★ " : "  "}${s.displayName}  (${s.documentCount} docs)\n   ID: ${s.id}`
            );
            return ok(`${stores.length} store(s) — ★ = active:\n\n${lines.join("\n\n")}`);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. get_active_store
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "get_active_store",
    "Returns the currently active document store for this account.",
    {},
    async (_, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const settings = await getUserSettings(userId);
            if (!settings?.active_store_id) return ok("No active store set. Use set_active_store.");
            const stores = await getStoresByUser(userId);
            const store = stores.find(s => s.id === settings.active_store_id);
            return ok(`Active store: ${store?.displayName || settings.active_store_id}\nID: ${settings.active_store_id}`);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. set_active_store
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "set_active_store",
    "Set the active document store by ID or display name.",
    { storeId: z.string().describe("Store ID or display name") },
    async ({ storeId }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const store = await findStoreByUser(userId, storeId);
            if (!store) return err(`Store "${storeId}" not found.`);
            await setActiveStore(userId, store.id);
            return ok(`✅ Active store set to: ${store.displayName} (${store.id})`);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. list_documents
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "list_documents",
    "List the documents uploaded to a store.",
    {
        storeId: z.string().optional().describe("Store ID or name. Uses active store if omitted."),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
    },
    async ({ storeId, limit }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const settings = await getUserSettings(userId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return err("No storeId provided and no active store is set.");

            // Verify store belongs to user
            const store = await findStoreByUser(userId, resolvedId);
            if (!store) return err(`Store "${resolvedId}" not found.`);

            const docs = await getDocumentsByUser(userId, store.id, limit || 50);
            if (!docs.length) return ok(`Store "${store.displayName}" has no documents yet.`);

            const lines = docs.map((d, i) =>
                `${i + 1}. ${d.display_name || d.original_filename || d.id}\n   ID: ${d.id}`
            );
            return ok(`${docs.length} document(s) in "${store.displayName}":\n\n${lines.join("\n\n")}`);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. summarize
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "summarize",
    "Generate a summary of all documents in a store.",
    {
        storeId: z.string().optional().describe("Store ID or name."),
        focus: z.string().optional().describe("Optional topic to focus the summary on."),
        model: z.string().optional().describe("Gemini model"),
    },
    async ({ storeId, focus, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const settings = await getUserSettings(userId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return err("No active store set.");

            const store = await findStoreByUser(userId, resolvedId);
            if (!store) return err(`Store "${resolvedId}" not found.`);

            const prompt = focus
                ? `Provide a comprehensive summary of the documents, focusing specifically on: ${focus}`
                : "Provide a comprehensive summary of all documents in this knowledge base.";

            const answer = await ragQuery({
                query: prompt,
                storeNames: [toStoreName(store.id)],
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });
            return ok(answer);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. delete_document
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "delete_document",
    "Permanently delete a document from a store. The document must belong to your account.",
    {
        documentId: z.string().describe("Document ID (UUID from list_documents)"),
        storeId: z.string().optional().describe("Store ID. Uses active store if omitted."),
    },
    async ({ documentId, storeId }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return err("No user session found.");

        try {
            const settings = await getUserSettings(userId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return err("Store ID required.");

            // Ownership check: verify the document belongs to this user
            const docs = await getDocumentsByUser(userId, resolvedId, 500);
            const doc = docs.find(d => d.id === documentId);
            if (!doc) return err(`Document "${documentId}" not found in your store. Use list_documents to see available IDs.`);

            // Delete from Gemini file search store
            const docGeminiName = `${toStoreName(resolvedId)}/documents/${documentId}`;
            try {
                await ai.fileSearchStores.documents.delete({ name: docGeminiName });
            } catch (e) {
                // 404 is fine — document may already be gone from Gemini
                if (!e.message?.includes("404")) throw e;
            }

            // Delete from Supabase (authoritative store)
            await sbPatch("documents", { id: documentId, user_id: userId }, { deleted_at: new Date().toISOString() });

            return ok(`✅ Deleted: ${doc.display_name || doc.original_filename || documentId}`);
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. get_document_link
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "get_document_link",
    "Generates a view URL and a download link for a document. Accepts document name or ID.",
    {
        documentId: z.string().describe("Document name, original filename, or UUID"),
        storeId: z.string().optional().describe("Store ID or name. Uses active store if omitted."),
    },
    async ({ documentId, storeId }, extra) => {
        const session = resolveSessionFromExtra(extra);
        if (!session?.userId) return err("No user session found.");
        const userId = session.userId;
        const sessionToken = session.token;

        try {
            const settings = await getUserSettings(userId);
            let activeStoreId = storeId || settings?.active_store_id || null;
            if (!activeStoreId) return err("No store specified and no active store set. Use set_active_store first.");

            // Resolve store by name/id, verifying ownership
            const store = await findStoreByUser(userId, activeStoreId);
            if (!store) return err(`Store "${activeStoreId}" not found.`);
            activeStoreId = store.id;

            // Fetch document list from Supabase (authoritative; Gemini only has opaque names)
            const docs = await getDocumentsByUser(userId, activeStoreId, 500);
            if (!docs.length) return err(`No documents found in store "${store.displayName}". Upload some files first.`);

            const q = documentId.toLowerCase().trim();
            const doc =
                docs.find(d => d.id.toLowerCase() === q) ||
                docs.find(d => (d.display_name || "").toLowerCase() === q) ||
                docs.find(d => (d.original_filename || "").toLowerCase() === q) ||
                docs.find(d => (d.display_name || "").toLowerCase().includes(q)) ||
                docs.find(d => (d.original_filename || "").toLowerCase().includes(q));

            if (!doc) {
                const available = docs.slice(0, 10)
                    .map(d => `• ${d.display_name || d.original_filename || d.id}`)
                    .join("\n");
                return ok(
                    `Document "${documentId}" not found in store "${store.displayName}".\n\n` +
                    `Available documents (up to 10):\n${available}`
                );
            }

            const viewUrl = `${APP_URL}/?tab=docs&storeId=${activeStoreId}&docId=${doc.id}`;
            const downloadUrl = `${APP_URL}/api/stores/${activeStoreId}/documents/${doc.id}/download?token=${sessionToken}`;

            return ok(
                `📄 ${doc.display_name || doc.original_filename || doc.id}\n\n` +
                `View:     ${viewUrl}\nDownload: ${downloadUrl}`
            );
        } catch (e) { return err(e); }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. help
// ─────────────────────────────────────────────────────────────────────────────
registerTool("help", "Show available tools and usage.", {}, async () => ok(
    `Gemini RAG MCP v2.2\n\n` +
    `Tools:\n` +
    tools.filter(t => t.name !== "help").map(t => `  • ${t.name} — ${t.description}`).join("\n")
));

// ── Response helpers ──────────────────────────────────────────────────────────
function ok(text) { return { content: [{ type: "text", text: String(text) }] }; }
function err(e) { return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] }; }

// ── Per-session MCP Server factory ───────────────────────────────────────────
function createSessionServer(sessionId) {
    const s = new Server(
        { name: "gemini-rag", version: "2.2.0" },
        { capabilities: { tools: {} } }
    );

    s.setRequestHandler(ListToolsRequestSchema, async () => {
        addMcpLog(`[${sessionId}] list_tools`);
        return { tools: getCachedToolSchemas() };
    });

    s.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = tools.find(t => t.name === request.params.name);
        if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);

        addMcpLog(`[${sessionId}] → ${request.params.name}`);

        const zodSchema = tool.schema._def ? tool.schema : z.object(tool.schema);
        let args;
        try {
            args = zodSchema.parse(request.params.arguments || {});
        } catch (e) {
            const msg = e instanceof z.ZodError
                ? `Invalid arguments: ${e.errors.map(x => `${x.path.join(".")}: ${x.message}`).join(", ")}`
                : e.message;
            throw new Error(msg);
        }

        try {
            return await tool.handler(args, { transport: { sessionId } });
        } catch (e) {
            addMcpLog(`[${sessionId}] ✗ ${request.params.name}: ${e.message}`);
            throw e;
        }
    });

    s.onerror = (error) => addMcpLog(`[${sessionId}] Server error: ${error.message}`);
    return s;
}

// ── SSE transport handler ──────────────────────────────────────────────────────
const handleSse = async (req, res) => {
    const userId = req.userId;
    const endpoint = req.path;

    try {
        addMcpLog(`Handshake: user=${userId} endpoint=${endpoint}`);

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const transport = new SSEServerTransport(endpoint, res);
        const sid = transport.sessionId;
        const sessionServer = createSessionServer(sid);

        sessions.set(sid, {
            transport,
            server: sessionServer,
            userId,
            token: req.token,
            establishedAt: new Date().toISOString(),
        });

        await sessionServer.connect(transport);
        addMcpLog(`Session established: ${sid} (user=${userId})`);

        // Heartbeat — keeps the SSE connection alive through proxies/load balancers
        const heartbeat = setInterval(() => {
            if (res.writableEnded) { clearInterval(heartbeat); return; }
            res.write(": heartbeat\n\n");
        }, 15_000);

        transport.onclose = () => {
            clearInterval(heartbeat);
            const session = sessions.get(sid);
            if (session) {
                sessionHistory.unshift({
                    sessionId: sid,
                    userId: session.userId,
                    established: session.establishedAt,
                    closedAt: new Date().toISOString(),
                });
                if (sessionHistory.length > MAX_SESSION_HISTORY) sessionHistory.pop();
            }
            addMcpLog(`Session closed: ${sid}`);
            sessions.delete(sid);
        };

        // If the HTTP response is closed server-side (e.g. client crash), clean up
        res.on("close", () => {
            if (sessions.has(sid)) {
                clearInterval(heartbeat);
                sessions.delete(sid);
                addMcpLog(`Session force-closed (res.close): ${sid}`);
            }
        });

    } catch (e) {
        addMcpLog(`SSE Error: ${e.message}`);
        if (!res.headersSent) res.status(500).send(`SSE connection failed: ${e.message}`);
    }
};

// ── POST message handler ───────────────────────────────────────────────────────
const handlePost = async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId query parameter." });

    const session = sessions.get(sessionId);
    if (!session) {
        addMcpLog(`POST rejected: session ${sessionId} not found`);
        return res.status(400).json({ error: "Session not found or expired. Re-open the SSE connection." });
    }

    try {
        await session.transport.handlePostMessage(req, res);
    } catch (e) {
        addMcpLog(`POST error [${sessionId}]: ${e.message}`);
        if (!res.writableEnded) res.status(500).json({ error: e.message });
    }
};

// ── Route registration ─────────────────────────────────────────────────────────
app.get("/sse", auth, handleSse);
app.post("/sse", handlePost);

app.get("/mcp", auth, handleSse);
app.post("/mcp", handlePost);

// /messages is a legacy alias — kept for compatibility, same validation applies
app.post("/messages", handlePost);

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.MCP_PORT || "3001", 10);
app.listen(PORT, () => {
    addMcpLog(`Gemini RAG MCP Server v2.2 — http://localhost:${PORT}/sse`);
    addMcpLog(`Tools: ${tools.map(t => t.name).join(", ")}`);
    addMcpLog(`CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
