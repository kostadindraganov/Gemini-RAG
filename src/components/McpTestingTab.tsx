"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

interface McpEndpoint {
    id: string;
    url: string;
    isActive: boolean;
    createdAt: string;
}

interface LogEntry {
    time: string;
    type: "info" | "error" | "send" | "receive";
    message: string;
    data?: any;
    id: number;
}

export default function McpTestingTab() {
    const [endpoints, setEndpoints] = useState<McpEndpoint[]>([]);
    const [mcpApiKey, setMcpApiKey] = useState("");
    const [selectedEndpointId, setSelectedEndpointId] = useState<string>("localhost");

    const [client, setClient] = useState<Client | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

    const [tools, setTools] = useState<any[]>([]);
    const [selectedTool, setSelectedTool] = useState<any | null>(null);
    const [toolArgs, setToolArgs] = useState<string>("{\n  \n}");

    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});

    const addLog = (type: LogEntry["type"], message: string, data?: any) => {
        setLogs(prev => [...prev.slice(-99), {
            id: Date.now() + Math.random(),
            time: new Date().toLocaleTimeString(),
            type,
            message,
            data
        }]);
    };

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    // Fetch endpoints and API keys on mount
    useEffect(() => {
        const fetchAll = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;
                const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
                setAuthHeaders(headers);

                const [epRes, keyRes] = await Promise.all([
                    fetch("/api/mcp-endpoints", { headers }),
                    fetch("/api/mcp-keys", { headers })
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
            } catch (err) {
                console.error("Failed to load endpoints/keys", err);
            }
        };

        fetchAll();
        return () => {
            // Unmount cleanup
            setClient(currentClient => {
                if (currentClient) {
                    try {
                        // @ts-ignore
                        currentClient.transport?.close?.();
                    } catch (e) { }
                }
                return null;
            });
        };
    }, []);

    const endpointOptions: (McpEndpoint | { id: "localhost"; url: string; isActive: boolean; createdAt: string })[] = [
        { id: "localhost", url: "http://localhost:3001/sse", isActive: endpoints.length === 0, createdAt: "" },
        ...endpoints,
    ];

    const selectedEndpoint = endpointOptions.find(e => e.id === selectedEndpointId) || endpointOptions[0];

    const handleConnect = async () => {
        if (connectionStatus === "connected" || connectionStatus === "connecting") return;

        try {
            setConnectionStatus("connecting");
            addLog("info", `Connecting to ${selectedEndpoint.url}...`);
            setTools([]);
            setSelectedTool(null);

            // In a production setup, we might proxy remote calls if CORS blocks us, 
            // but for this testing tool we attempt direct connection or via same-origin rewrite
            // Note: If using the localhost fallback, use the rewrite "/sse" instead of direct to avoid CORS in some setups.
            // But we allow absolute URLs for custom endpoints.
            const sseUrl = selectedEndpoint.id === "localhost"
                ? `${window.location.origin}/sse`
                : selectedEndpoint.url;

            let urlWithKey = sseUrl;
            if (mcpApiKey) {
                // Attach the token as a query parameter for SSE
                const urlObj = new URL(sseUrl, window.location.origin);
                urlObj.searchParams.set("token", mcpApiKey);
                urlWithKey = urlObj.toString();
            }

            const transport = new SSEClientTransport(new URL(urlWithKey));

            const mcpClient = new Client({
                name: "mcp-testing-client",
                version: "1.0.0"
            }, {
                capabilities: {
                    roots: { listChanged: false }
                }
            });

            await mcpClient.connect(transport);

            addLog("info", "Connected successfully.");
            setClient(mcpClient);
            setConnectionStatus("connected");

            // Fetch tools
            addLog("info", "Fetching tools...");
            const toolsResponse = await mcpClient.listTools();
            setTools(toolsResponse.tools || []);
            addLog("info", `Discovered ${toolsResponse.tools?.length || 0} tools.`);

        } catch (err: any) {
            addLog("error", `Connection failed: ${err.message}`);
            setConnectionStatus("disconnected");
            setClient(null);
        }
    };

    const handleDisconnect = () => {
        if (client) {
            try {
                // @ts-ignore - The transport might not expose close publicly, but we let it GC mostly
                client.transport?.close?.();
            } catch (e) { }
            setClient(null);
        }
        setConnectionStatus("disconnected");
        setTools([]);
        setSelectedTool(null);
        addLog("info", "Disconnected.");
    };

    const handleExecute = async () => {
        if (!client || !selectedTool) return;

        let parsedArgs = {};
        try {
            parsedArgs = JSON.parse(toolArgs || "{}");
        } catch (e) {
            addLog("error", "Invalid JSON in arguments field.");
            return;
        }

        addLog("send", `Calling tool "${selectedTool.name}"...`, parsedArgs);

        try {
            const result = await client.callTool({
                name: selectedTool.name,
                arguments: parsedArgs
            });
            console.log(result);
            addLog("receive", `Response from "${selectedTool.name}"`, result);
        } catch (err: any) {
            addLog("error", `Tool execution failed: ${err.message}`, err);
        }
    };

    const selectToolForExecution = (tool: any) => {
        setSelectedTool(tool);
        // Pre-fill a template based on the tool schema
        if (tool.inputSchema?.properties) {
            const template: Record<string, any> = {};
            for (const key of Object.keys(tool.inputSchema.properties)) {
                template[key] = "";
            }
            setToolArgs(JSON.stringify(template, null, 2));
        } else {
            setToolArgs("{\n  \n}");
        }
    };

    return (
        <div className="glass-panel" style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <h3 style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>🧪</span> MCP Testing Tool
            </h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: "1.6" }}>
                Test your MCP server directly from the browser.
                Configure your endpoint, connect, and execute tools without leaving the dashboard.
            </p>

            {/* CONNECTION PANEL */}
            <div style={{
                background: "rgba(0,0,0,0.2)",
                border: "1px solid var(--border-color)",
                borderRadius: "10px",
                padding: "1.25rem",
                marginBottom: "1.5rem"
            }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
                    <div>
                        <label className="form-label" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Target Endpoint</label>
                        <select
                            className="input-field"
                            value={selectedEndpointId}
                            onChange={e => setSelectedEndpointId(e.target.value)}
                            disabled={connectionStatus !== "disconnected"}
                        >
                            <option value="localhost">localhost:3001 (local fallback)</option>
                            {endpoints.map(ep => (
                                <option key={ep.id} value={ep.id}>
                                    {ep.url} {ep.isActive ? " (Active)" : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>MCP API Key / Token</label>
                        <input
                            type="password"
                            className="input-field"
                            value={mcpApiKey}
                            onChange={e => setMcpApiKey(e.target.value)}
                            placeholder="Optional API Key"
                            disabled={connectionStatus !== "disconnected"}
                        />
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <div style={{
                            width: "10px", height: "10px", borderRadius: "50%",
                            background: connectionStatus === "connected" ? "#22c55e"
                                : connectionStatus === "connecting" ? "#f59e0b" : "#ef4444",
                            boxShadow: connectionStatus === "connected" ? "0 0 8px #22c55e" : "none"
                        }} />
                        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                            {connectionStatus === "connected" ? "Connected"
                                : connectionStatus === "connecting" ? "Connecting..." : "Disconnected"}
                        </span>
                    </div>

                    <div>
                        {connectionStatus === "disconnected" ? (
                            <button className="btn-primary" onClick={handleConnect}>Connect to Server</button>
                        ) : (
                            <button className="btn-secondary" onClick={handleDisconnect} style={{ border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>Disconnect</button>
                        )}
                    </div>
                </div>
            </div>

            {/* MAIN TEST INTERFACE */}
            <div style={{ display: "flex", flex: 1, gap: "1.5rem", minHeight: "400px" }}>

                {/* Tools Sidebar */}
                <div style={{
                    width: "30%",
                    minWidth: "250px",
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(0,0,0,0.15)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "10px",
                    overflow: "hidden"
                }}>
                    <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border-color)", fontWeight: 600, fontSize: "0.85rem" }}>
                        Available Tools ({tools.length})
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
                        {tools.length === 0 ? (
                            <div style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                                {connectionStatus === "connected" ? "No tools discovered." : "Connect to discover tools."}
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                {tools.map((tool) => (
                                    <div
                                        key={tool.name}
                                        onClick={() => selectToolForExecution(tool)}
                                        style={{
                                            padding: "0.75rem",
                                            background: selectedTool?.name === tool.name ? "rgba(59, 130, 246, 0.15)" : "var(--bg-color)",
                                            border: `1px solid ${selectedTool?.name === tool.name ? "rgba(59, 130, 246, 0.4)" : "var(--border-color)"}`,
                                            borderRadius: "8px",
                                            cursor: "pointer",
                                            transition: "all 0.2s"
                                        }}
                                    >
                                        <div style={{ fontWeight: 600, color: "var(--accent-1)", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                                            {tool.name}
                                        </div>
                                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                            {tool.description || "No description"}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Execution & Logs */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>

                    {/* Tool Runner */}
                    <div style={{
                        flex: 1,
                        background: "rgba(0,0,0,0.15)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "10px",
                        padding: "1rem",
                        display: "flex",
                        flexDirection: "column"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                            <h4 style={{ margin: 0 }}>
                                {selectedTool ? `Execute: ${selectedTool.name}` : "Select a tool to execute"}
                            </h4>
                            {selectedTool && (
                                <button className="btn-primary" onClick={handleExecute} style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}>
                                    Run Tool
                                </button>
                            )}
                        </div>

                        {selectedTool ? (
                            <>
                                <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>Arguments (JSON)</label>
                                <textarea
                                    className="input-field"
                                    style={{ flex: 1, fontFamily: "monospace", fontSize: "0.85rem", resize: "none", minHeight: "150px" }}
                                    value={toolArgs}
                                    onChange={(e) => setToolArgs(e.target.value)}
                                    spellCheck={false}
                                />
                                {selectedTool.inputSchema?.properties && Object.keys(selectedTool.inputSchema.properties).length > 0 && (
                                    <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                        <strong>Expected properties: </strong>
                                        {Object.entries(selectedTool.inputSchema.properties).map(([k, v]: [string, any]) => (
                                            <span key={k} style={{ marginRight: "10px" }}><code>{k}</code> ({v.type})</span>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                                ← Select a tool from the sidebar
                            </div>
                        )}
                    </div>

                    {/* Event Log */}
                    <div style={{
                        flex: 1,
                        background: "rgba(10, 15, 25, 0.6)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "10px",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden"
                    }}>
                        <div style={{ padding: "0.5rem 1rem", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border-color)", fontWeight: 600, fontSize: "0.8rem", display: "flex", justifyContent: "space-between" }}>
                            <span>Event Log</span>
                            <button onClick={() => setLogs([])} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.7rem", cursor: "pointer" }}>Clear</button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {logs.length === 0 ? (
                                <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "1rem" }}>No events yet.</div>
                            ) : (
                                logs.map(log => (
                                    <div key={log.id} style={{ marginBottom: "0.75rem" }}>
                                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem", color: "var(--text-muted)" }}>
                                            <span>[{log.time}]</span>
                                            <span style={{
                                                color: log.type === "error" ? "#ef4444"
                                                    : log.type === "info" ? "#3b82f6"
                                                        : log.type === "send" ? "#f59e0b" : "#10b981",
                                                fontWeight: 600,
                                                textTransform: "uppercase"
                                            }}>
                                                {log.type}
                                            </span>
                                            <span style={{ color: "#e2e8f0" }}>{log.message}</span>
                                        </div>
                                        {log.data && (
                                            <pre style={{
                                                margin: "0.25rem 0 0 1.5rem",
                                                padding: "0.5rem",
                                                background: "rgba(0,0,0,0.3)",
                                                borderRadius: "4px",
                                                color: "#94a3b8",
                                                whiteSpace: "pre-wrap",
                                                wordBreak: "break-all"
                                            }}>
                                                {JSON.stringify(log.data, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                ))
                            )}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
