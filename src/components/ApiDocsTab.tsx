"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────
interface McpEndpoint {
    id: string;
    url: string;
    isActive: boolean;
    createdAt: string;
}

// ── MCP Tools reference ────────────────────────────────────────────────────────
const MCP_TOOLS = [
    { name: "chat", badge: "RAG", color: "#22c55e", desc: "Ask a question using your active store — the primary tool." },
    { name: "chat_with_store", badge: "RAG", color: "#22c55e", desc: "Ask using a specific store by ID or display name." },
    { name: "chat_all_stores", badge: "RAG", color: "#22c55e", desc: "Search across ALL stores simultaneously." },
    { name: "summarize", badge: "RAG", color: "#22c55e", desc: "Generate a summary of documents in a store (optional focus topic)." },
    { name: "list_stores", badge: "Stores", color: "#3b82f6", desc: "List all stores. ★ marks the currently active one." },
    { name: "get_active_store", badge: "Stores", color: "#3b82f6", desc: "Show which store is active (used by the chat tool)." },
    { name: "set_active_store", badge: "Stores", color: "#3b82f6", desc: "Switch the active store — syncs with the Gemini RAG UI." },
    { name: "list_documents", badge: "Docs", color: "#a855f7", desc: "List uploaded files in a store." },
    { name: "delete_document", badge: "Docs", color: "#a855f7", desc: "Permanently delete a document from a store." },
    { name: "help", badge: "Meta", color: "#64748b", desc: "Show all available tools." },
];

const BADGE_BG: Record<string, string> = {
    RAG: "rgba(34,197,94,0.12)",
    Stores: "rgba(59,130,246,0.12)",
    Docs: "rgba(168,85,247,0.12)",
    Meta: "rgba(100,116,139,0.12)",
};

// ── Code examples (non-MCP) ────────────────────────────────────────────────────
const CODE_EXAMPLES = {
    js: `import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. Create a store
const store = await ai.fileSearchStores.create({
  config: { displayName: "My Documentation" }
});

// 2. Upload a document
let op = await ai.fileSearchStores.uploadToFileSearchStore({
  file: "guide.pdf",
  fileSearchStoreName: store.name,
  config: { displayName: "Guide.pdf" }
});
while (!op.done) {
  await new Promise(r => setTimeout(r, 5000));
  op = await ai.operations.get({ operation: op });
}

// 3. Chat with your documents
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Summarize this guide.",
  config: {
    tools: [{ fileSearch: { fileSearchStoreNames: [store.name] } }]
  }
});
console.log(response.text);
`,
    python: `from google import genai
import time

client = genai.Client()

# 1. Create a store
store = client.file_search_stores.create(
    config={'display_name': 'My Documentation'}
)

# 2. Upload a document
op = client.file_search_stores.upload_to_file_search_store(
    file='guide.pdf',
    file_search_store_name=store.name,
    config={'display_name': 'Guide.pdf'}
)
while not op.done:
    time.sleep(5)
    op = client.operations.get(op)

# 3. Chat with your documents
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Summarize this guide.",
    config={"tools": [{"file_search": {"file_search_store_names": [store.name]}}]}
)
print(response.text)
`,
    curl: `export GEMINI_API_KEY="your_api_key"
export STORE="fileSearchStores/YOUR_STORE_ID"

curl -X POST \\
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\${GEMINI_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{"role":"user","parts":[{"text":"Explain the guide"}]}],
    "tools": [{"file_search":{"file_search_store_names":["'"$STORE"'"]}}]
  }'
`,
};

// ── Generate MCP config JSON for an endpoint ──────────────────────────────────
function buildMcpConfig(endpoint: McpEndpoint | null, apiKey: string): string {
    const url = endpoint?.url || "http://localhost:3001/sse";
    return JSON.stringify({
        mcpServers: {
            "gemini-rag": {
                url,
                headers: { Authorization: `Bearer ${apiKey || "<your-mcp-api-key>"}` }
            }
        }
    }, null, 2);
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function ApiDocsTab() {
    const [lang, setLang] = useState<"js" | "python" | "curl">("js");
    const [copied, setCopied] = useState<string | null>(null);
    const [endpoints, setEndpoints] = useState<McpEndpoint[]>([]);
    const [mcpApiKey, setMcpApiKey] = useState("");
    const [selectedEndpointId, setSelectedEndpointId] = useState<string>("localhost");
    const [endpointsLoaded, setEndpointsLoaded] = useState(false);
    const [mcpStatus, setMcpStatus] = useState<{ sessions: any[], logs: any[] }>({ sessions: [], logs: [] });

    // Fetch endpoints + first MCP API key on mount
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch("/api/mcp-status");
                if (res.ok) {
                    const data = await res.json();
                    setMcpStatus(data);
                }
            } catch { /* ignore */ }
        };

        const fetchEndpointsAndKeys = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;
                const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

                const [epRes, keyRes] = await Promise.all([
                    fetch("/api/mcp-endpoints", { headers }),
                    fetch("/api/mcp-keys", { headers }),
                ]);

                if (epRes.ok) {
                    const { endpoints: eps } = await epRes.json();
                    setEndpoints(eps || []);
                    const active = (eps || []).find((e: McpEndpoint) => e.isActive);
                    if (active) setSelectedEndpointId(active.id);
                }

                if (keyRes.ok) {
                    const { keys } = await keyRes.json();
                    if (keys?.length) setMcpApiKey(keys[0].keyValue || "");
                }
            } catch { /* non-critical */ } finally {
                setEndpointsLoaded(true);
            }
        };

        fetchStatus();
        fetchEndpointsAndKeys();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    // All endpoint options: custom ones + always-available localhost fallback
    const endpointOptions: (McpEndpoint | { id: "localhost"; url: string; isActive: boolean; createdAt: string })[] = [
        { id: "localhost", url: "http://localhost:3001/sse", isActive: endpoints.length === 0, createdAt: "" },
        ...endpoints,
    ];

    const selectedEndpoint = endpointOptions.find(e => e.id === selectedEndpointId) || endpointOptions[0];
    const configText = buildMcpConfig(selectedEndpoint as McpEndpoint, mcpApiKey);

    return (
        <div className="glass-panel" style={{ height: "100%", overflowY: "auto" }}>
            <h3 style={{ marginBottom: "0.5rem" }}>Integration Documentation</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: "1.6" }}>
                Connect to the Gemini File Search RAG system via SDK, REST API, or the built-in MCP server.
            </p>

            {/* ── SDK / REST Examples ─────────────────────────────────────── */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                {(["js", "python", "curl"] as const).map(l => (
                    <button key={l} className={lang === l ? "btn-primary" : "btn-secondary"} onClick={() => setLang(l)}>
                        {l === "js" ? "Node.js SDK" : l === "python" ? "Python SDK" : "REST / cURL"}
                    </button>
                ))}
            </div>

            <div className="code-container" style={{ position: "relative", marginBottom: "2.5rem" }}>
                <button className="copy-btn" onClick={() => handleCopy(CODE_EXAMPLES[lang], "sdk")}>
                    {copied === "sdk" ? "Copied!" : "Copy"}
                </button>
                <pre><code style={{ color: "#a8b1c2" }}>{CODE_EXAMPLES[lang]}</code></pre>
            </div>

            {/* ── MCP Server Config ───────────────────────────────────────── */}
            <div style={{ marginBottom: "2.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                        <h4 style={{ marginBottom: "0.25rem" }}>MCP Server Config</h4>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.83rem" }}>
                            Paste into Claude Desktop, Cursor, or any MCP-compatible client.
                        </p>
                    </div>
                    {/* Endpoint selector */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: "220px" }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>Endpoint</label>
                        <select
                            className="input-field"
                            style={{ fontSize: "0.82rem", padding: "0.4rem 2rem 0.4rem 0.65rem" }}
                            value={selectedEndpointId}
                            onChange={e => setSelectedEndpointId(e.target.value)}
                        >
                            <option value="localhost">localhost:3001 (local)</option>
                            {endpoints.map(ep => (
                                <option key={ep.id} value={ep.id}>
                                    {ep.url} {ep.isActive ? "★" : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Config block per selected endpoint */}
                <div style={{ position: "relative" }}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: "0.6rem",
                        padding: "0.5rem 1rem", background: "rgba(0,0,0,0.3)",
                        borderRadius: "8px 8px 0 0", borderBottom: "1px solid var(--border-color)",
                        borderTop: "1px solid var(--border-color)",
                        borderLeft: "1px solid var(--border-color)",
                        borderRight: "1px solid var(--border-color)",
                    }}>
                        <span style={{ display: "flex", gap: "5px" }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", flex: 1 }}>mcp-config.json</span>
                        <span style={{
                            fontSize: "0.68rem", fontWeight: 600, padding: "2px 8px",
                            borderRadius: "10px", background: "rgba(59,130,246,0.15)",
                            color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)"
                        }}>
                            {selectedEndpoint.url}
                        </span>
                    </div>
                    <div className="code-container" style={{ margin: 0, borderRadius: "0 0 8px 8px" }}>
                        <button className="copy-btn" onClick={() => handleCopy(configText, "config")}>
                            {copied === "config" ? "Copied!" : "Copy"}
                        </button>
                        <pre><code style={{ color: "#a8b1c2" }}>{configText}</code></pre>
                    </div>
                </div>

                {/* All endpoints at once */}
                {endpoints.length > 1 && (
                    <div style={{ marginTop: "1rem" }}>
                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
                            All your custom endpoints — multi-server config:
                        </p>
                        <div style={{ position: "relative" }}>
                            <div className="code-container" style={{ margin: 0 }}>
                                <button className="copy-btn" onClick={() => handleCopy(buildAllEndpointsConfig(endpoints, mcpApiKey), "all")}>
                                    {copied === "all" ? "Copied!" : "Copy All"}
                                </button>
                                <pre><code style={{ color: "#a8b1c2" }}>{buildAllEndpointsConfig(endpoints, mcpApiKey)}</code></pre>
                            </div>
                        </div>
                    </div>
                )}

                {/* Hint if no custom endpoints */}
                {endpointsLoaded && endpoints.length === 0 && (
                    <div style={{
                        marginTop: "0.75rem", padding: "0.75rem 1rem",
                        background: "rgba(59,130,246,0.06)", borderRadius: "8px",
                        border: "1px solid rgba(59,130,246,0.2)", fontSize: "0.82rem",
                        color: "var(--text-secondary)", lineHeight: 1.5
                    }}>
                        💡 <strong>Tip:</strong> Add a custom domain or IP in <strong>Settings → MCP Endpoints</strong> and it will appear here as a ready-to-copy config block.
                    </div>
                )}
            </div>

            {/* ── MCP Tools Reference ─────────────────────────────────────── */}
            <div>
                <h4 style={{ marginBottom: "0.4rem" }}>MCP Tools Reference</h4>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.83rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
                    {MCP_TOOLS.length} tools available. Start with <code>help</code>, then use <code>chat</code> to ask questions about your documents.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {MCP_TOOLS.map(t => (
                        <div key={t.name} style={{
                            display: "flex", alignItems: "center", gap: "0.9rem",
                            padding: "0.75rem 1rem", background: "rgba(0,0,0,0.18)",
                            borderRadius: "10px", border: "1px solid var(--border-color)"
                        }}>
                            <span style={{
                                flexShrink: 0, fontSize: "0.68rem", fontWeight: 700,
                                padding: "2px 8px", borderRadius: "10px",
                                background: BADGE_BG[t.badge], color: t.color,
                                border: `1px solid ${t.color}33`, minWidth: "44px", textAlign: "center"
                            }}>{t.badge}</span>
                            <code style={{ color: "var(--accent-1)", fontWeight: 600, fontSize: "0.88rem", flexShrink: 0 }}>{t.name}</code>
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem", lineHeight: 1.4 }}>{t.desc}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── MCP Server Status & Logs ─────────────────────────────────── */}
            <div style={{ marginTop: "3rem", paddingTop: "2rem", borderTop: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.25rem" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
                    <h4 style={{ margin: 0 }}>Server Monitoring</h4>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "auto" }}>Live updates every 5s</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem" }}>
                    {/* Active Sessions */}
                    <div style={{ background: "rgba(0,0,0,0.15)", borderRadius: "12px", border: "1px solid var(--border-color)", overflow: "hidden" }}>
                        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border-color)", background: "rgba(255,255,255,0.03)", fontSize: "0.8rem", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                            <span>Active Client Sessions</span>
                            <span style={{ color: "var(--accent-1)" }}>{mcpStatus.sessions.length}</span>
                        </div>
                        <div style={{ maxHeight: "250px", overflowY: "auto", padding: "0.5rem" }}>
                            {mcpStatus.sessions.length === 0 ? (
                                <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                                    No active clients connected.
                                </div>
                            ) : (
                                mcpStatus.sessions.map((s, idx) => (
                                    <div key={idx} style={{ padding: "0.6rem 0.75rem", borderRadius: "8px", background: "rgba(255,255,255,0.02)", marginBottom: "0.4rem", border: "1px solid rgba(255,255,255,0.05)" }}>
                                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.2rem", display: "flex", justifyContent: "space-between" }}>
                                            <span>Session ID:</span>
                                            <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>{s.sessionId?.slice(0, 8) || "unknown"}...</span>
                                        </div>
                                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                                            <span>Connected:</span>
                                            <span style={{ color: "var(--text-secondary)" }}>{s.established ? new Date(s.established).toLocaleTimeString() : "unknown"}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Server Logs */}
                    <div style={{ background: "rgba(0,0,0,0.15)", borderRadius: "12px", border: "1px solid var(--border-color)", overflow: "hidden" }}>
                        <div style={{
                            padding: "0.75rem 1rem", borderBottom: "1px solid var(--border-color)",
                            background: "rgba(255,255,255,0.03)", fontSize: "0.8rem", fontWeight: 600,
                            display: "flex", justifyContent: "space-between", alignItems: "center"
                        }}>
                            <span>Recent Server Activity</span>
                            <button
                                onClick={async () => {
                                    try {
                                        await fetch("/api/mcp-logs/clear", { method: "POST" });
                                        setMcpStatus(prev => ({ ...prev, logs: [] }));
                                    } catch { }
                                }}
                                style={{
                                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: "4px", padding: "2px 8px", color: "var(--text-muted)",
                                    fontSize: "0.65rem", cursor: "pointer", transition: "all 0.2s"
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as any).style.background = "rgba(239, 68, 68, 0.1)"; (e.currentTarget as any).style.color = "#f87171"; }}
                                onMouseLeave={(e) => { (e.currentTarget as any).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as any).style.color = "var(--text-muted)"; }}
                            >
                                Clear
                            </button>
                        </div>
                        <div style={{ maxHeight: "250px", overflowY: "auto", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {mcpStatus.logs.length === 0 ? (
                                <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-muted)" }}>
                                    Waiting for activity...
                                </div>
                            ) : (
                                [...mcpStatus.logs].reverse().map((log) => (
                                    <div key={log.id} style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.03)", color: "#a8b1c2", display: "flex", gap: "0.75rem" }}>
                                        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>[{new Date(log.time).toLocaleTimeString()}]</span>
                                        <span style={{ color: log.message.includes("POST") ? "var(--accent-2)" : log.message.includes("establish") ? "var(--accent-1)" : "inherit" }}>
                                            {log.message}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Helper: build a single JSON with all custom endpoints as named servers ─────
function buildAllEndpointsConfig(endpoints: McpEndpoint[], apiKey: string): string {
    const servers: Record<string, unknown> = {};
    endpoints.forEach((ep, i) => {
        const name = i === 0 ? "gemini-rag" : `gemini-rag-${i + 1}`;
        servers[name] = {
            url: ep.url,
            headers: { Authorization: `Bearer ${apiKey || "<your-mcp-api-key>"}` }
        };
    });
    return JSON.stringify({ mcpServers: servers }, null, 2);
}
