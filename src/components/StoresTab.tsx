import { useState } from "react";

export default function StoresTab({
    onStoresChange,
    stores,
    accessToken,
    accountTier,
    onSelectStore,
    onSwitchTab
}: {
    onStoresChange: () => void,
    stores: any[],
    accessToken: string,
    accountTier?: string,
    onSelectStore?: (id: string) => void,
    onSwitchTab?: (tab: any) => void
}) {
    const [storeName, setStoreName] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [chunkSize, setChunkSize] = useState(500);
    const [chunkOverlap, setChunkOverlap] = useState(50);

    const handleCreate = async () => {
        if (!storeName.trim() || isCreating) return;
        setIsCreating(true);
        setError(null);

        try {
            const res = await fetch("/api/stores", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                body: JSON.stringify({
                    displayName: storeName,
                    chunkingConfig: {
                        maxTokensPerChunk: chunkSize,
                        maxOverlapTokens: chunkOverlap
                    }
                })
            });

            if (!res.ok) {
                throw new Error((await res.json()).error || "Failed to create store");
            }

            setStoreName("");
            onStoresChange();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsCreating(false);
        }
    };

    const handleDelete = async (storeId: string) => {
        if (!confirm("Delete this store forever? All documents will be lost.")) return;
        try {
            const res = await fetch(`/api/stores/${storeId}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
            if (!res.ok) throw new Error("Failed to delete store");
            onStoresChange();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const formatSize = (bytes: number) => {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const totalStoresSize = stores.reduce((acc, store) => acc + (store.totalSize || 0), 0);
    const maxProjectSizes: Record<string, number> = {
        free: 1 * 1024 * 1024 * 1024,       // 1 GB
        tier1: 10 * 1024 * 1024 * 1024,     // 10 GB
        tier2: 100 * 1024 * 1024 * 1024,    // 100 GB
        tier3: 1024 * 1024 * 1024 * 1024    // 1 TB
    };
    const tierLabels: Record<string, string> = {
        free: 'Free Tier',
        tier1: 'Tier 1 (Pay-As-You-Go)',
        tier2: 'Tier 2 (Pay-As-You-Go)',
        tier3: 'Tier 3 (Pay-As-You-Go)'
    };
    const maxProjectSize = maxProjectSizes[accountTier || "free"] || maxProjectSizes["free"];
    const isPro = accountTier && accountTier !== "free";
    const usagePercent = Math.min(100, (totalStoresSize / maxProjectSize) * 100);

    return (
        <div className="glass-panel" style={{ height: "100%", overflowY: "auto" }}>
            {error && <div style={{ color: "var(--error-color)", marginBottom: "1rem" }}>{error}</div>}

            <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                <h3 style={{ marginBottom: "1rem", color: "var(--text-primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    Google File Search Quotas
                    <span style={{ fontSize: "0.75rem", padding: "4px 8px", borderRadius: "12px", background: isPro ? "rgba(109, 40, 217, 0.2)" : "rgba(255,255,255,0.1)", color: isPro ? "var(--accent-1)" : "var(--text-secondary)", border: isPro ? "1px solid var(--accent-1)" : "1px solid var(--border-color)" }}>
                        {tierLabels[accountTier || "free"]}
                    </span>
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                    <div>
                        <ul style={{ paddingLeft: "1.2rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                            <li>Maximum file size: <strong>100 MB</strong></li>
                            <li>Recommend limit: <strong>under 20 GB</strong> per individual store for optimal latency</li>
                            <li>Not supported in the Live API</li>
                        </ul>
                    </div>
                    <div>
                        <ul style={{ paddingLeft: "1.2rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                            <li>Supported App formats: <strong>PDF, DOCX, ZIP, JSON, SQL, TS/JS/PY/JAVA etc.</strong></li>
                            <li>Supported Text formats: <strong>TXT, HTML, MD, CSV, RTF, CSS, YAML etc.</strong></li>
                            <li>Supported Image formats: <strong>JPG, PNG, WEBP, HEIC</strong> (Processed natively)</li>
                        </ul>
                    </div>
                </div>

                <div style={{ marginTop: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem", fontSize: "0.85rem" }}>
                        <span>Storage Usage: {formatSize(totalStoresSize)}</span>
                        <span>{formatSize(maxProjectSize)} (Maximum Limit)</span>
                    </div>
                    <div style={{ width: "100%", height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ width: `${usagePercent}%`, height: "100%", background: "var(--accent-1)", borderRadius: "4px" }} />
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ marginBottom: "2rem", background: "rgba(109, 40, 217, 0.05)" }}>
                <h3 style={{ marginBottom: "1rem" }}>Create New Store</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                    <div>
                        <label className="form-label">Store Name (Display)</label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="e.g. Finance Docs 2024"
                            value={storeName}
                            onChange={e => setStoreName(e.target.value)}
                        />
                    </div>
                    <div style={{ display: "flex", gap: "1rem" }}>
                        <div style={{ flex: 1 }}>
                            <label className="form-label">Max Tokens / Chunk</label>
                            <input
                                type="number"
                                className="input-field"
                                value={chunkSize}
                                onChange={e => setChunkSize(Number(e.target.value))}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label className="form-label">Overlap Tokens</label>
                            <input
                                type="number"
                                className="input-field"
                                value={chunkOverlap}
                                onChange={e => setChunkOverlap(Number(e.target.value))}
                            />
                        </div>
                    </div>
                </div>
                <button
                    className="btn-primary"
                    onClick={handleCreate}
                    disabled={!storeName.trim() || isCreating}
                >
                    {isCreating ? "Creating..." : "+ Create Store"}
                </button>
            </div>

            <h3 style={{ marginBottom: "1rem" }}>Available Stores</h3>
            {stores.length === 0 ? (
                <p style={{ color: "var(--text-secondary)" }}>No stores created yet.</p>
            ) : (
                <div className="glass-panel" style={{ padding: 0, overflow: "hidden" }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Internal ID</th>
                                <th>Documents</th>
                                <th>Size</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stores.map(store => (
                                <tr key={store.id}>
                                    <td style={{ fontWeight: 600 }}>
                                        <button
                                            onClick={() => {
                                                if (onSelectStore) onSelectStore(store.id);
                                                if (onSwitchTab) onSwitchTab("docs");
                                            }}
                                            style={{
                                                background: "none",
                                                border: "none",
                                                padding: 0,
                                                color: "var(--accent-1)",
                                                fontWeight: 600,
                                                cursor: "pointer",
                                                textDecoration: "none",
                                                textAlign: "left"
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.textDecoration = "underline"}
                                            onMouseOut={(e) => e.currentTarget.style.textDecoration = "none"}
                                        >
                                            {store.displayName}
                                        </button>
                                    </td>
                                    <td style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "var(--text-secondary)" }}>{store.id}</td>
                                    <td>{store.documentCount}</td>
                                    <td>{formatSize(store.totalSize)}</td>
                                    <td>{new Date(store.createdAt).toLocaleDateString()}</td>
                                    <td>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => handleDelete(store.id)}
                                            style={{ color: "var(--error-color)", padding: "0.4rem 0.8rem" }}
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
