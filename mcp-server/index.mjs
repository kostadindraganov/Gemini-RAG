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

if (!GEMINI_API_KEY) { console.error("[MCP] GEMINI_API_KEY not set"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ── Supabase helpers (safe) ──────────────────────────────────────────────────
async function sbFetch(path, params = {}) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return null;
    try {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const res = await fetch(url.toString(), {
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Supabase error: ${res.status} ${err}`);
        }
        return await res.json();
    } catch (e) {
        addMcpLog(`sbFetch error [${path}]: ${e.message}`);
        return null;
    }
}

async function sbPatch(path, filter, body) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return;
    try {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
        Object.entries(filter).forEach(([k, v]) => url.searchParams.set(k, `eq.${v}`));
        await fetch(url.toString(), {
            method: "PATCH",
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    } catch (e) {
        addMcpLog(`sbPatch error [${path}]: ${e.message}`);
    }
}

// ── Auth: validate key and resolve userId ─────────────────────────────────────
async function resolveUser(bearerToken) {
    // If we have no DB config, allow everything with no userId for local dev
    if (!SUPABASE_URL || !SUPABASE_ANON) {
        return { userId: null, valid: true };
    }

    const rows = await sbFetch("mcp_api_keys", {
        "key_value": `eq.${bearerToken}`,
        "is_active": "eq.true",
        "select": "id,user_id"
    });

    if (!rows || rows.length === 0) return { userId: null, valid: false };

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

// Internal session Map: sessionId -> { transport, userId }
const sessions = new Map();

app.use((req, res, next) => {
    // Log incoming requests for debugging (excluding heartbeats/noisy logs if preferred)
    if (req.url !== "/mcp-status" && req.url !== "/" && !req.url.startsWith("/api/mcp-status")) {
        addMcpLog(`${req.method} ${req.url}`);
    }
    next();
});

app.get("/", (req, res) => res.send("Gemini RAG MCP Server is alive."));

// ── Status & Monitoring ───────────────────────────────────────────────────────
// Simple in-memory log buffer for the UI
const MAX_LOGS = 50;
const mcpLogs = [];
const addMcpLog = (msg) => {
    const log = { id: Date.now() + Math.random(), time: new Date().toISOString(), message: msg };
    mcpLogs.push(log);
    if (mcpLogs.length > MAX_LOGS) mcpLogs.shift();
    console.log(`[MCP] ${msg}`);
};

app.get("/api/mcp-status", (req, res) => {
    // This is called via Next.js proxy, so we might need auth if exposed publicly,
    // but for now it's internal to the server.
    const activeSessions = Array.from(sessions.entries()).map(([sid, session]) => ({
        sessionId: sid,
        userId: session.userId,
        established: session.establishedAt,
    }));

    res.json({
        status: "online",
        version: "2.1.0",
        sessions: activeSessions,
        logs: mcpLogs
    });
});


// ── Auth middleware (safe) ───────────────────────────────────────────────────
const auth = async (req, res, next) => {
    try {
        let token = "";
        const header = req.headers.authorization;
        if (header?.startsWith("Bearer ")) {
            token = header.slice(7);
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            addMcpLog(`${req.method} ${req.url} - 401: Unauthorized (No token)`);
            return res.status(401).json({ error: "Missing token. Use Bearer header or ?token= query param." });
        }

        const { userId, valid } = await resolveUser(token);
        if (!valid) {
            addMcpLog(`${req.method} ${req.url} - 403: Forbidden (Invalid key)`);
            return res.status(403).json({ error: "Invalid or inactive MCP API key." });
        }

        req.userId = userId;
        next();
    } catch (e) {
        addMcpLog(`Auth error: ${e.message}`);
        res.status(500).json({ error: "Internal server error during authentication" });
    }
};

// ── Helper: resolve userId from extra (transport session) ───────────────────
function resolveUserIdFromExtra(extra) {
    const sessionId = extra?.transport?.sessionId;
    if (!sessionId) return null;
    return sessions.get(sessionId)?.userId;
}

// ── MCP Server Logic (Reusable) ───────────────────────────────────────────────

const serverInfo = { name: "gemini-rag", version: "2.1.0" };

// We define tools in a registry so we can attach them to multiple server instances
// (needed because McpServer/Server instances are 1:1 with transports)
const tools = [];
function registerTool(name, description, schema, handler) {
    tools.push({ name, description, schema, handler });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. chat  ▸ The primary tool
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "chat",
    "Chat with your documents. Asks a question and gets an answer grounded in your uploaded files.",
    {
        message: z.string().describe("Your question or message to answer using the documents"),
        storeId: z.string().optional().describe("Store ID to search. Omit to use your active store."),
        model: z.string().optional().describe("Gemini model (default: gemini-2.5-flash)"),
    },
    async ({ message, storeId, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const settings = await getUserSettings(userId);
            const resolvedStoreId = storeId || settings?.active_store_id;

            if (!resolvedStoreId) {
                return { content: [{ type: "text", text: "⚠️ No active store set. Use set_active_store first." }] };
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
// 2. chat_with_store
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "chat_with_store",
    "Chat with documents in a specific store by its ID or display name.",
    {
        message: z.string().describe("Your question or message"),
        storeId: z.string().describe("Store ID or display name"),
        model: z.string().optional().describe("Gemini model"),
    },
    async ({ message, storeId, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const stores = await getAllStores();
            const store = await findStore(storeId, stores);
            if (!store) return { content: [{ type: "text", text: `Store "${storeId}" not found.` }] };

            const settings = await getUserSettings(userId);
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
// 3. chat_all_stores
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "chat_all_stores",
    "Ask a question and search across ALL of your document stores simultaneously.",
    {
        message: z.string().describe("Your question or message"),
        model: z.string().optional().describe("Gemini model"),
    },
    async ({ message, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const stores = await getAllStores();
            if (!stores.length) return { content: [{ type: "text", text: "No stores found." }] };

            const settings = await getUserSettings(userId);
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
// 4. list_stores
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "list_stores",
    "List all available document stores with their IDs and names.",
    {},
    async (_, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const stores = await getAllStores();
            if (!stores.length) return { content: [{ type: "text", text: "No stores found." }] };

            const settings = await getUserSettings(userId);
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
// 5. get_active_store
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "get_active_store",
    "Returns the currently active document store.",
    {},
    async (_, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const settings = await getUserSettings(userId);
            if (!settings?.active_store_id) return { content: [{ type: "text", text: "No active store set." }] };
            const stores = await getAllStores();
            const store = stores.find(s => s.id === settings.active_store_id);
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
// 6. set_active_store
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "set_active_store",
    "Set the active document store.",
    { storeId: z.string().describe("Store ID or display name") },
    async ({ storeId }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const stores = await getAllStores();
            const store = await findStore(storeId, stores);
            if (!store) return { content: [{ type: "text", text: `Store "${storeId}" not found.` }] };
            await setActiveStore(userId, store.id);
            return { content: [{ type: "text", text: `✅ Active store set to: ${store.displayName}` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. list_documents
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "list_documents",
    "List the documents/files uploaded to a store.",
    {
        storeId: z.string().optional().describe("Store ID. Uses the active store if omitted."),
        limit: z.number().optional().describe("Max results (default 50)"),
    },
    async ({ storeId, limit }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const settings = await getUserSettings(userId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return { content: [{ type: "text", text: "No storeId and no active store is set." }] };

            const storeName = toStoreName(resolvedId);
            const docs = await getStoreDocuments(storeName, limit || 50);
            if (!docs.length) return { content: [{ type: "text", text: `No documents in store.` }] };

            const lines = docs.map((d, i) => `${i + 1}. ${d.displayName}\n   ID: ${d.id}`);
            return { content: [{ type: "text", text: `${docs.length} document(s):\n\n${lines.join("\n\n")}` }] };
        } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }] };
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. summarize
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "summarize",
    "Generate a summary of all documents in a store.",
    {
        storeId: z.string().optional().describe("Store ID."),
        focus: z.string().optional().describe("Optional topic to focus on"),
        model: z.string().optional().describe("Gemini model"),
    },
    async ({ storeId, focus, model }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const settings = await getUserSettings(userId);
            const resolvedId = storeId || settings?.active_store_id;
            if (!resolvedId) return { content: [{ type: "text", text: "No active store set." }] };

            const storeName = toStoreName(resolvedId);
            const prompt = focus ? `Summary focus: ${focus}` : "Comprehensive summary.";
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
// 9. delete_document
// ─────────────────────────────────────────────────────────────────────────────
registerTool(
    "delete_document",
    "Permanently delete a document from a store.",
    {
        documentId: z.string().describe("Document ID"),
        storeId: z.string().optional().describe("Store ID"),
    },
    async ({ documentId, storeId }, extra) => {
        const userId = resolveUserIdFromExtra(extra);
        if (!userId) return { content: [{ type: "text", text: "Error: No user session found." }] };

        try {
            const settings = await getUserSettings(userId);
            const resolvedId = storeId || settings?.active_store_id;
            let docName = documentId;
            if (!docName.includes("/")) {
                if (!resolvedId) return { content: [{ type: "text", text: "Store ID required." }] };
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
// 10. help
// ─────────────────────────────────────────────────────────────────────────────
registerTool("help", "Show help.", {}, async () => ({
    content: [{ type: "text", text: `Gemini RAG MCP v2.1\nUse chat, list_stores, etc.` }]
}));

/**
 * Creates a fresh, independent Server instance for a new transport session.
 * Using the low-level Server class ensures no shared state between sessions.
 */
function createSessionServer(sessionId) {
    const s = new Server(
        { name: "gemini-rag", version: "2.1.0" },
        { capabilities: { tools: {} } }
    );

    // Register List Tools handler
    s.setRequestHandler(ListToolsRequestSchema, async () => {
        addMcpLog(`[Session ${sessionId}] Client requested tool list`);
        return {
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: zodToJsonSchema(t.schema)
            }))
        };
    });

    // Register Call Tool handler
    s.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = tools.find(t => t.name === request.params.name);
        if (!tool) throw new Error(`Tool not found: ${request.params.name}`);

        addMcpLog(`[Session ${sessionId}] Calling tool: ${request.params.name}`);

        try {
            // Manually parse arguments using the Zod schema
            const args = tool.schema.parse(request.params.arguments || {});
            return await tool.handler(args, { transport: { sessionId } });
        } catch (e) {
            addMcpLog(`[Session ${sessionId}] Tool execution failed: ${e.message}`);
            throw e; // MCP SDK will wrap this in a JSON-RPC error
        }
    });

    s.onerror = (error) => addMcpLog(`[Session ${sessionId}] Server Error: ${error.message}`);

    return s;
}

// ── SSE transport handling (Session-aware) ────────────────────────────────────

const handleSse = async (req, res) => {
    try {
        const userId = req.userId;
        const endpoint = req.path;

        addMcpLog(`Starting handshaking for user: ${userId} at ${endpoint}`);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        // Create transport - endpoint is the path where the client will POST messages
        const transport = new SSEServerTransport(endpoint, res);
        const sid = transport.sessionId;

        addMcpLog(`Assigned SessionId: ${sid}`);

        // CREATE A NEW SERVER INSTANCE FOR THIS TRANSPORT
        const sessionServer = createSessionServer(sid);
        await sessionServer.connect(transport);

        sessions.set(sid, { transport, server: sessionServer, userId, establishedAt: new Date().toISOString() });

        addMcpLog(`Session ${sid} established for user ${userId}`);

        const heartbeat = setInterval(() => {
            if (!res.writableEnded) {
                res.write(': heartbeat\n\n');
            } else {
                clearInterval(heartbeat);
            }
        }, 15000);

        transport.onclose = () => {
            addMcpLog(`Session ${sid} closed`);
            clearInterval(heartbeat);
            sessions.delete(sid);
        };
    } catch (e) {
        addMcpLog(`SSE Error: ${e.message}`);
        if (!res.headersSent) {
            res.status(500).send(`SSE Connection failed: ${e.message}`);
        }
    }
};

const handlePost = async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
        return res.status(400).send("Missing sessionId query parameter.");
    }

    const session = sessions.get(sessionId);
    if (!session) {
        console.warn(`[MCP] POST rejected: Session ${sessionId} not found.`);
        return res.status(400).send("Session not found or expired. Please re-open the SSE connection.");
    }

    // Inject userId into req.auth so transport.handlePostMessage passes it to tool extra
    req.auth = { userId: session.userId };

    try {
        await session.transport.handlePostMessage(req, res);
    } catch (e) {
        console.error(`[MCP] Session ${sessionId} POST error: ${e.message}`);
        if (!res.writableEnded) res.status(500).send(e.message);
    }
};

app.get("/sse", auth, handleSse);
app.post("/sse", express.json(), handlePost); // No 'auth' on POST because sessionId is the secret

app.get("/mcp", auth, handleSse);
app.post("/mcp", express.json(), handlePost);

app.post("/messages", express.json(), handlePost);

const PORT = process.env.MCP_PORT || 3001;
app.listen(PORT, () => {
    console.log(`[MCP] Gemini RAG Server v2.1 — http://localhost:${PORT}/sse`);
    console.log(`[MCP] Tools: chat, chat_with_store, chat_all_stores, summarize, list_stores, get_active_store, set_active_store, list_documents, delete_document, help`);
});
