import { useState, useEffect } from "react";

const gridStyles = `
  .mcp-endpoint-grid {
    display: grid;
    grid-template-columns: 1fr 120px 200px;
    align-items: stretch;
  }
  .grid-header-row {
    display: contents;
  }
  .grid-cell-head {
    padding: 1rem;
    background: rgba(255,255,255,0.03);
    border-bottom: 1px solid var(--border-color);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 600;
  }
  .grid-add-row {
    display: contents;
  }
  .grid-data-row {
    display: contents;
  }
  .grid-cell {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    background: transparent;
    transition: background 0.2s;
  }
  .grid-data-row:hover .grid-cell {
    background: rgba(255,255,255,0.01);
  }
  .grid-add-row .grid-cell {
    background: rgba(34,197,94,0.02);
  }
  
  @media (max-width: 768px) {
    .mcp-endpoint-grid {
      grid-template-columns: 1fr;
    }
    .grid-header-row {
      display: none;
    }
    .grid-cell-head {
      display: none;
    }
    .grid-add-row, .grid-data-row {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--border-color);
      padding: 1rem;
      background: rgba(255,255,255,0.02);
      margin-bottom: 0.5rem;
      border-radius: 8px;
    }
    .grid-cell {
      padding: 0.4rem 0;
      border-bottom: none;
      background: transparent !important;
    }
    .status-cell {
      order: -1;
      margin-bottom: 0.5rem;
    }
    .url-cell {
      font-weight: 600;
      color: var(--text-primary);
    }
    .actions-cell {
      margin-top: 0.5rem;
      border-top: 1px solid rgba(255,255,255,0.05);
      padding-top: 0.75rem;
    }
  }
`;

interface McpKey {
    id: string;
    keyValue: string;
    label: string;
    isActive: boolean;
    createdAt: string;
    lastUsedAt: string | null;
}

interface McpEndpoint {
    id: string;
    url: string;
    isActive: boolean;
    createdAt: string;
}

export default function SettingsTab({ accessToken, accountTier, onTierChange }: { accessToken: string, accountTier: string, onTierChange: (tier: string) => void }) {
    const [systemPrompt, setSystemPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [mcpUrl, setMcpUrl] = useState("");
    const [mcpEndpoints, setMcpEndpoints] = useState<McpEndpoint[]>([]);
    const [newEndpointUrl, setNewEndpointUrl] = useState("");
    const [isCreatingEndpoint, setIsCreatingEndpoint] = useState(false);
    const [tierInfo, setTierInfo] = useState<{ tier: string; label: string; note: string; detected: boolean; storageLimitBytes: number } | null>(null);
    const [isFetchingTier, setIsFetchingTier] = useState(false);

    // MCP Keys state
    const [mcpKeys, setMcpKeys] = useState<McpKey[]>([]);
    const [newKeyLabel, setNewKeyLabel] = useState("");
    const [isCreatingKey, setIsCreatingKey] = useState(false);
    const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

    const headers = (): Record<string, string> => ({
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
    });

    useEffect(() => {
        const defaultUrl = window.location.protocol + "//" + window.location.hostname + ":3001/sse";
        setMcpUrl(defaultUrl);

        fetchState();
        fetchMcpKeys();
        fetchMcpEndpoints();
        fetchAccountTier();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const formatSseUrl = (input: string): string => {
        let url = input.trim().replace(/\/+$/, ''); // trim and remove trailing slashes
        if (!url) return '';

        const isIpOrLocalhost = url.startsWith('localhost') || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url) || url.includes('127.0.0.1');

        // 1. Ensure protocol
        if (!/^https?:\/\//i.test(url)) {
            url = (isIpOrLocalhost ? 'http://' : 'https://') + url;
        }

        // 2. Helper to check if string has a port
        const hasPort = (): boolean => {
            try { return !!new URL(url).port; } catch {
                const parts = url.split('/');
                const hostPart = parts[2] || '';
                return hostPart.includes(':');
            }
        };

        // 3. Add default port 3001 ONLY for IPs or localhost if missing
        if (!hasPort() && isIpOrLocalhost) {
            const parts = url.split('/');
            if (parts[2]) {
                parts[2] = parts[2] + ':3001';
                url = parts.join('/');
            }
        }

        // 4. Ensure path ends with /sse
        if (!url.toLowerCase().endsWith('/sse')) {
            url = url + '/sse';
        }

        // 5. Final validation/cleanup via URL if possible
        try {
            return new URL(url).toString();
        } catch {
            return url; // fallback to string-built version for invalid IPs
        }
    };

    const fetchAccountTier = async () => {
        setIsFetchingTier(true);
        try {
            const res = await fetch("/api/account-tier", { headers: headers() });
            const data = await res.json();
            if (!data.error) {
                setTierInfo(data);
                onTierChange(data.tier === 'paid' ? 'tier1' : 'free');
            }
        } catch (e) {
            console.error("Tier detection failed", e);
        } finally {
            setIsFetchingTier(false);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes >= 1024 ** 4) return (bytes / 1024 ** 4).toFixed(0) + ' TB';
        if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(0) + ' GB';
        if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + ' MB';
        return bytes + ' B';
    };

    const fetchMcpEndpoints = async () => {
        try {
            const res = await fetch("/api/mcp-endpoints", { headers: headers() });
            const data = await res.json();
            if (data.endpoints) {
                setMcpEndpoints(data.endpoints);
                const active = data.endpoints.find((e: McpEndpoint) => e.isActive);
                if (active) {
                    setMcpUrl(active.url);
                }
            }
        } catch (e) {
            console.error("Failed to fetch endpoints", e);
        }
    };

    const handleCreateEndpoint = async () => {
        if (isCreatingEndpoint || !newEndpointUrl.trim()) return;
        setIsCreatingEndpoint(true);
        try {
            const formatted = formatSseUrl(newEndpointUrl);
            const res = await fetch("/api/mcp-endpoints", {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ url: formatted })
            });
            const data = await res.json();
            if (data.endpoints) {
                setMcpEndpoints(data.endpoints);
                setMcpUrl(formatted);
                setNewEndpointUrl("");
                setMessage("Endpoint created & activated!");
                setTimeout(() => setMessage(""), 3000);
            }
        } catch (e) {
            setMessage("Failed to save endpoint.");
        } finally {
            setIsCreatingEndpoint(false);
        }
    };

    const handleDeleteEndpoint = async (endpointId: string) => {
        try {
            const res = await fetch("/api/mcp-endpoints", {
                method: "DELETE",
                headers: headers(),
                body: JSON.stringify({ endpointId })
            });
            const data = await res.json();
            if (data.endpoints) {
                setMcpEndpoints(data.endpoints);
                const active = data.endpoints.find((e: McpEndpoint) => e.isActive);
                if (active) {
                    setMcpUrl(active.url);
                } else {
                    const defaultUrl = window.location.protocol + "//" + window.location.hostname + ":3001/sse";
                    setMcpUrl(defaultUrl);
                }
            }
        } catch (e) {
            setMessage("Failed to delete endpoint.");
        }
    };

    const handleToggleEndpoint = async (endpointId: string, isActive: boolean) => {
        try {
            const res = await fetch("/api/mcp-endpoints", {
                method: "PATCH",
                headers: headers(),
                body: JSON.stringify({ endpointId, isActive })
            });
            const data = await res.json();
            if (data.endpoints) {
                setMcpEndpoints(data.endpoints);
                const active = data.endpoints.find((e: McpEndpoint) => e.isActive);
                if (active) {
                    setMcpUrl(active.url);
                } else {
                    const defaultUrl = window.location.protocol + "//" + window.location.hostname + ":3001/sse";
                    setMcpUrl(defaultUrl);
                }
            }
        } catch (e) {
            setMessage("Failed to toggle endpoint.");
        }
    };

    const fetchState = async () => {
        try {
            const res = await fetch("/api/state", { headers: headers() });
            const data = await res.json();
            setSystemPrompt(data.systemPrompt || "");
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchMcpKeys = async () => {
        try {
            const res = await fetch("/api/mcp-keys", { headers: headers() });
            const data = await res.json();
            setMcpKeys(data.keys || []);
        } catch (e) {
            console.error("Failed to fetch MCP keys", e);
        }
    };

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await fetch("/api/state", {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ systemPrompt })
            });
            setMessage("Settings saved successfully!");
            setTimeout(() => setMessage(""), 3000);
        } catch (e) {
            setMessage("Failed to save settings.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateKey = async () => {
        if (isCreatingKey) return;
        setIsCreatingKey(true);
        setNewlyCreatedKey(null);
        try {
            const res = await fetch("/api/mcp-keys", {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ label: newKeyLabel || "API Key" })
            });
            const data = await res.json();
            if (data.keys) setMcpKeys(data.keys);
            if (data.key?.keyValue) setNewlyCreatedKey(data.key.keyValue);
            setNewKeyLabel("");
            setMessage("API Key created!");
            setTimeout(() => setMessage(""), 3000);
        } catch (e) {
            setMessage("Failed to create key.");
        } finally {
            setIsCreatingKey(false);
        }
    };

    const handleDeleteKey = async (keyId: string) => {
        if (!confirm("Delete this API key? Any client using it will lose access.")) return;
        try {
            const res = await fetch("/api/mcp-keys", {
                method: "DELETE",
                headers: headers(),
                body: JSON.stringify({ keyId })
            });
            const data = await res.json();
            if (data.keys) setMcpKeys(data.keys);
            setMessage("Key deleted.");
            setTimeout(() => setMessage(""), 3000);
        } catch (e) {
            setMessage("Failed to delete key.");
        }
    };

    const handleToggleKey = async (keyId: string, isActive: boolean) => {
        try {
            const res = await fetch("/api/mcp-keys", {
                method: "PATCH",
                headers: headers(),
                body: JSON.stringify({ keyId, isActive })
            });
            const data = await res.json();
            if (data.keys) setMcpKeys(data.keys);
        } catch (e) {
            setMessage("Failed to toggle key.");
        }
    };

    const copyToClipboard = (text: string) => {
        if (!text) return;
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                setMessage("Copied to clipboard!");
                setTimeout(() => setMessage(""), 2000);
            }).catch(() => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    };

    const fallbackCopy = (text: string) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            setMessage("Copied to clipboard!");
            setTimeout(() => setMessage(""), 2000);
        } catch (err) {
            setMessage("Failed to copy. Please copy manually.");
        }
        document.body.removeChild(textArea);
    };

    if (isLoading) return <div style={{ padding: "2rem" }}>Loading settings...</div>;

    return (
        <div className="glass-panel" style={{ height: "100%", overflowY: "auto" }}>
            <style>{gridStyles}</style>
            <h3 style={{ marginBottom: "1rem" }}>System Instructions</h3>
            <div className="form-group">
                <label className="form-label">Chatbot System Prompt</label>
                <textarea
                    className="input-field"
                    style={{ minHeight: "100px" }}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Enter instructions on how the AI should behave..."
                />
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
                    This prompt configures how the RAG model responds to the user.
                </p>
            </div>

            {/* Account Tier Detection */}
            <div className="form-group" style={{ marginTop: "2rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "2rem" }}>
                <label className="form-label">Google AI Account Tier</label>
                {isFetchingTier ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem", background: "rgba(0,0,0,0.2)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                        <div className="typing-indicator" style={{ transform: "scale(0.7)" }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Detecting account tier via Gemini API…</span>
                    </div>
                ) : tierInfo ? (
                    <div style={{ padding: "1rem 1.25rem", background: tierInfo.tier === 'paid' ? "rgba(34, 197, 94, 0.06)" : "rgba(255,255,255,0.04)", borderRadius: "10px", border: `1px solid ${tierInfo.tier === 'paid' ? 'rgba(34, 197, 94, 0.3)' : 'var(--border-color)'}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, color: tierInfo.tier === 'paid' ? "var(--accent-1)" : "var(--text-primary)" }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                                {tierInfo.label}
                            </span>
                            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: "10px" }}>
                                {tierInfo.detected ? "Auto-detected" : "Fallback"}
                            </span>
                        </div>
                        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "0.75rem", lineHeight: 1.5 }}>{tierInfo.note}</p>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                Min. storage limit: <strong style={{ color: "var(--text-primary)" }}>{formatBytes(tierInfo.storageLimitBytes)}</strong>
                            </span>
                            <a href="https://console.cloud.google.com/iam-admin/quotas" target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.78rem", color: "var(--accent-3)" }}>View exact quotas →</a>
                        </div>
                    </div>
                ) : (
                    <div style={{ padding: "1rem", background: "rgba(0,0,0,0.15)", borderRadius: "10px", border: "1px solid var(--border-color)", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Could not detect account tier automatically.
                    </div>
                )}
                <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
                    <button
                        onClick={fetchAccountTier}
                        disabled={isFetchingTier}
                        style={{
                            background: "transparent",
                            border: "1px solid var(--border-color)",
                            borderRadius: "8px",
                            color: "var(--text-secondary)",
                            padding: "0.4rem 0.9rem",
                            cursor: "pointer",
                            fontSize: "0.82rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            transition: "all 0.2s ease"
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                            e.currentTarget.style.color = "var(--text-primary)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "var(--text-secondary)";
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
                        {isFetchingTier ? "Detecting…" : "Re-detect Tier"}
                    </button>

                    <a
                        href="https://aistudio.google.com/app/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "8px",
                            color: "var(--text-primary)",
                            padding: "0.4rem 0.9rem",
                            cursor: "pointer",
                            fontSize: "0.82rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            textDecoration: "none",
                            transition: "all 0.2s ease"
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                            e.currentTarget.style.borderColor = "var(--accent-1)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                            e.currentTarget.style.borderColor = "var(--border-color)";
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--accent-2)" }}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                        Google AI Studio
                    </a>
                </div>
            </div>

            <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ marginTop: "1rem" }}>
                Save Settings
            </button>
            {message && <span style={{ marginLeft: "1rem", color: "var(--accent-2)" }}>{message}</span>}

            {/* MCP Server Integration */}
            <div style={{ marginTop: "3rem", paddingTop: "2rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                <h3 style={{ marginBottom: "1rem" }}>MCP Server Integration</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: "1.6" }}>
                    This application includes a standalone Server-Sent Events (SSE) MCP server that exposes your
                    File Search stores and automated RAG querying abilities to external clients on the web.
                </p>

                <div className="form-group">
                    <label className="form-label">Connection Type</label>
                    <div style={{ padding: "0.8rem", background: "rgba(0,0,0,0.3)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)" }}>
                        HTTP with Server-Sent Events (SSE)
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Client Configuration / Web Endpoint</label>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
                        Because the new MCP server runs on Express/SSE instead of Stdio, you can directly bind it to any other external applications natively on Port 3001. Just provide this URL as the SSE endpoint and your Secret Key as the &quot;API Key&quot; / &quot;Bearer Token&quot;:
                    </p>
                    {/* Unified Grid-based Endpoints Management */}
                    <div className="form-group" style={{ marginBottom: "2rem" }}>
                        <label className="form-label">Endpoints Management & Overrides</label>
                        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                            Add custom SSE endpoints to override the default connection. Grid below manages all overrides.
                        </p>

                        <div className="glass-panel" style={{ padding: 0, overflow: "hidden", border: "1px solid var(--border-color)" }}>
                            <div className="mcp-endpoint-grid">
                                <div className="grid-header-row">
                                    <div className="grid-cell-head">Endpoint URL</div>
                                    <div className="grid-cell-head">Status</div>
                                    <div className="grid-cell-head">Actions</div>
                                </div>

                                <div className="grid-add-row">
                                    <div className="grid-cell">
                                        <div style={{ width: "100%" }}>
                                            <input
                                                type="text"
                                                className="input-field"
                                                placeholder="e.g. 100.94.105.87 or api.my-domain.com"
                                                value={newEndpointUrl}
                                                onChange={(e) => setNewEndpointUrl(e.target.value)}
                                                style={{ height: "36px", fontSize: "0.85rem", background: "rgba(0,0,0,0.2)" }}
                                            />
                                            {newEndpointUrl.trim() && (
                                                <div style={{ marginTop: "0.4rem", fontSize: "0.7rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    Preview: <span style={{ color: "var(--accent-1)" }}>{formatSseUrl(newEndpointUrl)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid-cell status-cell">
                                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>New Override</span>
                                    </div>
                                    <div className="grid-cell actions-cell">
                                        <button
                                            className="btn-primary"
                                            onClick={handleCreateEndpoint}
                                            disabled={isCreatingEndpoint || !newEndpointUrl.trim()}
                                            style={{ height: "36px", padding: "0 1rem", fontSize: "0.8rem", width: "100%" }}
                                        >
                                            {isCreatingEndpoint ? "..." : "+ Add Endpoint"}
                                        </button>
                                    </div>
                                </div>

                                {mcpEndpoints.map(e => (
                                    <div key={e.id} className="grid-data-row">
                                        <div className="grid-cell url-cell">
                                            <code style={{ fontSize: "0.8rem", color: e.isActive ? "var(--accent-1)" : "var(--text-secondary)" }}>{e.url}</code>
                                        </div>
                                        <div className="grid-cell status-cell">
                                            <span style={{
                                                padding: "0.2rem 0.6rem",
                                                borderRadius: "100px",
                                                fontSize: "0.75rem",
                                                fontWeight: 600,
                                                background: e.isActive ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)",
                                                color: e.isActive ? "var(--accent-1)" : "var(--text-muted)",
                                                border: `1px solid ${e.isActive ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.1)"}`
                                            }}>
                                                {e.isActive ? "Active" : "Inactive"}
                                            </span>
                                        </div>
                                        <div className="grid-cell actions-cell">
                                            <div style={{ display: "flex", gap: "0.4rem", width: "100%" }}>
                                                <button
                                                    className="btn-secondary"
                                                    onClick={() => handleToggleEndpoint(e.id, !e.isActive)}
                                                    style={{ flex: 1, padding: "0.3rem", fontSize: "0.75rem", height: "32px" }}
                                                >
                                                    {e.isActive ? "Off" : "On"}
                                                </button>
                                                <button
                                                    className="btn-secondary"
                                                    onClick={() => handleDeleteEndpoint(e.id)}
                                                    style={{ flex: 0.5, padding: "0.3rem", fontSize: "0.75rem", height: "32px", color: "var(--error-color)" }}
                                                >
                                                    Del
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div style={{ padding: "0.8rem", background: "rgba(0,0,0,0.3)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <div><strong style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Live SSE Endpoint:</strong> <code style={{ color: "var(--accent-2)" }}>{mcpUrl}</code></div>
                    </div>
                </div>

                {/* Multi-key Management */}
                <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <h4 style={{ marginBottom: "1rem" }}>API Keys</h4>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                        Create multiple API keys for different clients or integrations. Only <strong>active</strong> keys can authenticate with the MCP server.
                    </p>

                    {/* Create new key */}
                    <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", alignItems: "flex-end" }}>
                        <div style={{ flex: 1 }}>
                            <label className="form-label" style={{ fontSize: "0.8rem" }}>Key Label (optional)</label>
                            <input
                                type="text"
                                className="input-field"
                                placeholder="e.g. Dify Production"
                                value={newKeyLabel}
                                onChange={(e) => setNewKeyLabel(e.target.value)}
                            />
                        </div>
                        <button
                            className="btn-primary"
                            onClick={handleCreateKey}
                            disabled={isCreatingKey}
                            style={{ whiteSpace: "nowrap", height: "fit-content" }}
                        >
                            {isCreatingKey ? "Creating..." : "+ New Key"}
                        </button>
                    </div>

                    {/* Newly created key callout */}
                    {newlyCreatedKey && (
                        <div style={{
                            padding: "1rem",
                            borderRadius: "8px",
                            background: "rgba(34,197,94,0.08)",
                            border: "1px solid rgba(34,197,94,0.25)",
                            marginBottom: "1.5rem"
                        }}>
                            <p style={{ fontWeight: 600, color: "#22c55e", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                                ✅ Key created — copy it now, you won&apos;t see it in full again:
                            </p>
                            <code style={{
                                display: "block",
                                padding: "0.6rem 0.8rem",
                                background: "rgba(0,0,0,0.4)",
                                borderRadius: "6px",
                                wordBreak: "break-all",
                                cursor: "pointer",
                                color: "var(--accent-2)",
                                fontSize: "0.85rem"
                            }}
                                onClick={() => copyToClipboard(newlyCreatedKey!)}
                            >
                                {newlyCreatedKey}
                            </code>
                            <p
                                style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.5rem", cursor: "pointer", display: "inline-block" }}
                                onClick={() => copyToClipboard(newlyCreatedKey!)}
                            >
                                Click to copy
                            </p>
                        </div>
                    )}

                    {/* Keys list */}
                    {mcpKeys.length === 0 ? (
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                            No API keys created yet. Generate one to use with the MCP server.
                        </p>
                    ) : (
                        <div className="glass-panel" style={{ padding: 0, overflow: "hidden" }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Label</th>
                                        <th>Key</th>
                                        <th>Status</th>
                                        <th>Created</th>
                                        <th>Last Used</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mcpKeys.map(k => (
                                        <tr key={k.id}>
                                            <td style={{ fontWeight: 600 }}>{k.label}</td>
                                            <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                                    <span>{k.keyValue.slice(0, 8)}...{k.keyValue.slice(-4)}</span>
                                                    <button
                                                        onClick={() => copyToClipboard(k.keyValue)}
                                                        className="btn-send"
                                                        style={{ width: "24px", height: "24px", borderRadius: "4px", padding: "4px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)" }}
                                                        title="Copy full key"
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "14px", height: "14px" }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                    </button>
                                                </div>
                                            </td>
                                            <td>
                                                <span style={{
                                                    padding: "0.2rem 0.6rem",
                                                    borderRadius: "100px",
                                                    fontSize: "0.75rem",
                                                    fontWeight: 600,
                                                    background: k.isActive ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                                                    color: k.isActive ? "#22c55e" : "#ef4444",
                                                    border: `1px solid ${k.isActive ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`
                                                }}>
                                                    {k.isActive ? "Active" : "Inactive"}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: "0.85rem" }}>{new Date(k.createdAt).toLocaleDateString()}</td>
                                            <td style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                                                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                                            </td>
                                            <td>
                                                <div style={{ display: "flex", gap: "0.5rem" }}>
                                                    <button
                                                        className="btn-secondary"
                                                        onClick={() => handleToggleKey(k.id, !k.isActive)}
                                                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                                                    >
                                                        {k.isActive ? "Deactivate" : "Activate"}
                                                    </button>
                                                    <button
                                                        className="btn-secondary"
                                                        onClick={() => handleDeleteKey(k.id)}
                                                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", color: "var(--error-color)" }}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
