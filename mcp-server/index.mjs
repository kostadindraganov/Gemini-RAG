import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
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

if (!GEMINI_API_KEY) { console.error("[MCP] GEMINI_API_KEY not set"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sbFetch(path, params = {}) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
    });
    return res.ok ? res.json() : null;
}

async function sbPatch(path, filter, body) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    Object.entries(filter).forEach(([k, v]) => url.searchParams.set(k, `eq.${v}`));
    await fetch(url.toString(), {
        method: "PATCH",
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

// ── Auth: validate key and resolve userId ─────────────────────────────────────
async function resolveUser(bearerToken) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return { userId: null, valid: true }; // dev bypass

    const rows = await sbFetch("mcp_api_keys", {
        "key_value": `eq.${bearerToken}`,
        "is_active": "eq.true",
        "select": "id,user_id"
    });
    if (!rows?.length) return { userId: null, valid: false };

    const { id, user_id: userId } = rows[0];
    // fire-and-forget last_used update
    sbPatch("mcp_api_keys", { id }, { last_used_at: new Date().toISOString() }).catch(() => { });
    return { userId, valid: true };
}

// ── User settings (active store + model) ──────────────────────────────────────
async function getUserSettings(userId) {
    if (!userId) return null;
    const rows = await sbFetch("user_settings", {
        "user_id": `eq.${userId}`,
        "select": "active_store_id,active_model,system_prompt"
    });
    return rows?.[0] || null;
}

async function setActiveStore(userId, storeId) {
    if (!userId || !storeId) return;
    await sbPatch("user_settings", { user_id: userId }, { active_store_id: storeId });
}

// ── Gemini helpers ────────────────────────────────────────────────────────────
async function getAllStores() {
    const list = [];
    for await (const s of await ai.fileSearchStores.list()) {
        list.push({
            id: s.name?.replace("fileSearchStores/", "") || "",
            name: s.name || "",
            displayName: s.displayName || s.name || "",
        });
    }
    return list;
}

function toStoreName(id) {
    return id.startsWith("fileSearchStores/") ? id : `fileSearchStores/${id}`;
}

async function findStore(identifier, stores) {
    const q = identifier.toLowerCase();
    return stores.find(s =>
        s.id.toLowerCase() === q ||
        s.name.toLowerCase() === q ||
        s.displayName.toLowerCase() === q ||
        s.displayName.toLowerCase().includes(q)
    ) || null;
}

async function getStoreDocuments(storeName, limit = 50) {
    try {
        const result = await ai.fileSearchStores.documents.list({ parent: storeName, pageSize: limit });
        const items = result?.fileSearchDocuments || result?.documents || [];
        return items.map(d => ({
            id: d.name?.split("/").pop() || "",
            name: d.name,
            displayName: d.displayName || d.name || "",
            state: d.state || "unknown",
        }));
    } catch { return []; }
}

/**
 * Core RAG query — sends query to Gemini with File Search grounding.
 * storeNames: array of full store names ("fileSearchStores/xxx")
 * systemPrompt: optional persona/instructions
 */
async function ragQuery({ query, storeNames, model = "gemini-2.5-flash", systemPrompt, history = [] }) {
    const config = {
        tools: [{ fileSearch: { fileSearchStoreNames: storeNames } }],
    };
    if (systemPrompt) config.systemInstruction = systemPrompt;

    // Build contents array: prepend history if provided
    const contents = [
        ...history,
        { role: "user", parts: [{ text: query }] }
    ];

    const response = await ai.models.generateContent({
        model,
        contents,
        config,
    });
    return response.text || "(No response)";
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());

// Per-connection userId store (connection → userId)
const connectionUsers = new Map(); // transportId → userId

// Auth middleware
const auth = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing Authorization header. Use: Bearer <mcp-api-key>" });
    }
    const { userId, valid } = await resolveUser(header.slice(7));
    if (!valid) return res.status(403).json({ error: "Invalid or inactive MCP API key." });
    req.userId = userId;
    next();
};

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new McpServer({ name: "gemini-rag", version: "2.0.0" });

// userId is resolved per-connection and stored in connectionUsers.
// Each tool reads it via the module-level currentUserId (safe for SSE: 1 connection = 1 user at a time).
let currentUserId = null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. chat  ▸ The primary tool — chat with documents in the active store
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "chat",
    "Chat with your documents. Asks a question and gets an answer grounded in your uploaded files. Uses your active store by default.",
    {
        message: z.string().describe("Your question or message to answer using the documents"),
        storeId: z.string().optional().describe("Store ID to search. Omit to use your active store."),
        model: z.string().optional().describe("Gemini model (default: gemini-2.5-flash)"),
    },
    async ({ message, storeId, model }) => {
        try {
            const settings = await getUserSettings(currentUserId);
            const resolvedStoreId = storeId || settings?.active_store_id;

            if (!resolvedStoreId) {
                return { content: [{ type: "text", text: "⚠️ No active store set. Use set_active_store first, or select a store in the Gemini RAG UI." }] };
            }

            const storeName = toStoreName(resolvedStoreId);
            const answer = await ragQuery({
                query: message,
                storeNames: [storeName],
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });

            return { content: [{ type: "text", text: answer }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. chat_with_store  ▸ Same as chat but storeId is required
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "chat_with_store",
    "Chat with documents in a specific store by its ID or display name.",
    {
        message: z.string().describe("Your question or message"),
        storeId: z.string().describe("Store ID or display name (e.g. 'My Docs' or 'koko-abc123')"),
        model: z.string().optional().describe("Gemini model (default: gemini-2.5-flash)"),
    },
    async ({ message, storeId, model }) => {
        try {
            const stores = await getAllStores();
            const store = await findStore(storeId, stores);
            if (!store) {
                const names = stores.map(s => `• ${s.displayName} (${s.id})`).join("\n");
                return { content: [{ type: "text", text: `Store "${storeId}" not found.\n\nAvailable stores:\n${names}` }] };
            }

            const settings = await getUserSettings(currentUserId);
            const answer = await ragQuery({
                query: message,
                storeNames: [store.name],
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });

            return { content: [{ type: "text", text: answer }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. chat_all_stores  ▸ Search across ALL stores at once
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "chat_all_stores",
    "Ask a question and search across ALL of your document stores simultaneously.",
    {
        message: z.string().describe("Your question or message"),
        model: z.string().optional().describe("Gemini model (default: gemini-2.5-flash)"),
    },
    async ({ message, model }) => {
        try {
            const stores = await getAllStores();
            if (!stores.length) {
                return { content: [{ type: "text", text: "No stores found. Upload documents first." }] };
            }

            const settings = await getUserSettings(currentUserId);
            const answer = await ragQuery({
                query: message,
                storeNames: stores.map(s => s.name),
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });

            return { content: [{ type: "text", text: answer }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. list_stores  ▸ Show all available stores
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "list_stores",
    "List all available document stores with their IDs and names.",
    {},
    async () => {
        try {
            const stores = await getAllStores();
            if (!stores.length) return { content: [{ type: "text", text: "No stores found." }] };

            const settings = await getUserSettings(currentUserId);
            const activeId = settings?.active_store_id;

            const lines = stores.map(s =>
                `${s.id === activeId ? "★ " : "  "}${s.displayName}\n   ID: ${s.id}`
            );
            return { content: [{ type: "text", text: `${stores.length} store(s) — ★ = active:\n\n${lines.join("\n\n")}` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. get_active_store  ▸ Which store is currently selected?
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "get_active_store",
    "Returns the currently active document store (the one used by default when you call chat).",
    {},
    async () => {
        try {
            const settings = await getUserSettings(currentUserId);
            if (!settings?.active_store_id) {
                return { content: [{ type: "text", text: "No active store set. Use set_active_store to choose one." }] };
            }
            const stores = await getAllStores();
            const store = stores.find(s => s.id === settings.active_store_id || s.name === settings.active_store_id);
            return {
                content: [{
                    type: "text",
                    text: `Active store: ${store?.displayName || settings.active_store_id}\nID: ${settings.active_store_id}`
                }]
            };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. set_active_store  ▸ Switch which store to use
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "set_active_store",
    "Set the active document store. Changes take effect immediately and sync with the Gemini RAG UI.",
    {
        storeId: z.string().describe("Store ID or display name (partial match supported)"),
    },
    async ({ storeId }) => {
        try {
            const stores = await getAllStores();
            const store = await findStore(storeId, stores);
            if (!store) {
                const names = stores.map(s => `• ${s.displayName} (${s.id})`).join("\n");
                return { content: [{ type: "text", text: `Store "${storeId}" not found.\n\nAvailable:\n${names}` }] };
            }
            await setActiveStore(currentUserId, store.id);
            return { content: [{ type: "text", text: `✅ Active store set to: ${store.displayName} (${store.id})` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. list_documents  ▸ See what files are in a store
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "list_documents",
    "List the documents/files uploaded to a store. Uses the active store if storeId is not provided.",
    {
        storeId: z.string().optional().describe("Store ID. Uses the active store if omitted."),
        limit: z.number().optional().describe("Max results (default 50)"),
    },
    async ({ storeId, limit }) => {
        try {
            const settings = await getUserSettings(currentUserId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return { content: [{ type: "text", text: "No storeId and no active store is set." }] };

            const storeName = toStoreName(resolvedId);
            const docs = await getStoreDocuments(storeName, limit || 50);
            if (!docs.length) return { content: [{ type: "text", text: `No documents in store "${resolvedId}".` }] };

            const lines = docs.map((d, i) => `${i + 1}. ${d.displayName} (${d.state})\n   ID: ${d.id}`);
            return { content: [{ type: "text", text: `${docs.length} document(s):\n\n${lines.join("\n\n")}` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. summarize  ▸ Ask for a summary of all documents in a store
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "summarize",
    "Generate a summary of all documents in a store. Uses the active store if storeId is not provided.",
    {
        storeId: z.string().optional().describe("Store ID. Uses the active store if omitted."),
        focus: z.string().optional().describe("Optional: specific topic or aspect to focus the summary on"),
        model: z.string().optional().describe("Gemini model (default: gemini-2.5-flash)"),
    },
    async ({ storeId, focus, model }) => {
        try {
            const settings = await getUserSettings(currentUserId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return { content: [{ type: "text", text: "No active store set." }] };

            const storeName = toStoreName(resolvedId);
            const prompt = focus
                ? `Please provide a detailed summary of all documents, focusing specifically on: ${focus}`
                : "Please provide a comprehensive summary of all the documents in this store. Include the main topics, key points, and important details.";

            const answer = await ragQuery({
                query: prompt,
                storeNames: [storeName],
                model: model || settings?.active_model || "gemini-2.5-flash",
                systemPrompt: settings?.system_prompt || undefined,
            });
            return { content: [{ type: "text", text: answer }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. delete_document  ▸ Remove a file from a store
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "delete_document",
    "Permanently delete a document from a store. This cannot be undone.",
    {
        documentId: z.string().describe("Document ID or full document name"),
        storeId: z.string().optional().describe("Store ID (uses active store if omitted)"),
    },
    async ({ documentId, storeId }) => {
        try {
            const settings = await getUserSettings(currentUserId);
            const resolvedId = storeId || settings?.active_store_id;
            let docName = documentId;
            if (!docName.includes("/")) {
                if (!resolvedId) return { content: [{ type: "text", text: "Cannot resolve document without a storeId or active store." }] };
                docName = `${toStoreName(resolvedId)}/documents/${documentId}`;
            }
            await ai.fileSearchStores.documents.delete({ name: docName });
            return { content: [{ type: "text", text: `✅ Deleted: ${docName}` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. help  ▸ Show available tools
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
    "help",
    "List all available tools and how to use this MCP server.",
    {},
    async () => ({
        content: [{
            type: "text",
            text: `Gemini RAG MCP Server v2.0
═══════════════════════════

Primary tools (chat with your documents):
  chat              — Ask a question using your active store (recommended)
  chat_with_store   — Ask using a specific store by ID or name
  chat_all_stores   — Search across ALL stores simultaneously
  summarize         — Get a summary of all documents in a store

Store management:
  list_stores       — See all available stores (★ marks the active one)
  get_active_store  — Show which store is currently active
  set_active_store  — Switch the active store (syncs with the UI)

Document management:
  list_documents    — List files in a store
  delete_document   — Permanently delete a document

  help              — This message

Tip: Start with list_stores, then call chat to ask questions.`
        }]
    })
);

// ── SSE transport (one connection at a time) ──────────────────────────────────
let transport = null;

app.get("/sse", auth, async (req, res) => {
    currentUserId = req.userId;
    console.log(`[MCP] SSE connected (userId: ${currentUserId || "dev-mode"})`);
    transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
});

app.post("/messages", auth, express.json(), async (req, res) => {
    if (!transport) return res.status(400).send("No active SSE connection.");
    currentUserId = req.userId; // keep userId fresh on each message
    await transport.handlePostMessage(req, res);
});

const PORT = process.env.MCP_PORT || 3001;
app.listen(PORT, () => {
    console.log(`[MCP] Gemini RAG Server v2.0 — http://localhost:${PORT}/sse`);
    console.log(`[MCP] Tools: chat, chat_with_store, chat_all_stores, summarize, list_stores, get_active_store, set_active_store, list_documents, delete_document, help`);
});
