import { useState, useEffect } from "react";

export default function DocumentsTab({ activeStoreId, accessToken }: { activeStoreId: string; accessToken: string }) {
    const [documents, setDocuments] = useState<any[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [totalFiles, setTotalFiles] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (activeStoreId && accessToken) {
            setPage(1);
            setDocuments([]);
            fetchDocuments(1);
        } else {
            setDocuments([]);
            setHasMore(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeStoreId, accessToken]);

    const fetchDocuments = async (pageNumber: number) => {
        try {
            const res = await fetch(`/api/stores/${activeStoreId}/documents?page=${pageNumber}&limit=20`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data = await res.json();

            if (pageNumber === 1) {
                setDocuments(data.storedDocuments || []);
            } else {
                setDocuments(prev => [...prev, ...(data.storedDocuments || [])]);
            }
            setHasMore(data.hasMore);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const loadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchDocuments(nextPage);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeStoreId) {
            setError("Select a store first");
            return;
        }

        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        setIsUploading(true);
        setUploadProgress(0);
        setTotalFiles(files.length);
        setError(null);

        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append("file", file);

            try {
                // Pre-update progress slightly to show activity
                setUploadProgress((prev) => Math.min(prev + ((100 / files.length) * 0.2), 99));

                const res = await fetch(`/api/stores/${activeStoreId}/upload`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${accessToken}` },
                    body: formData,
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || `Upload failed for ${file.name}`);
                }
                successCount++;
            } catch (err: any) {
                setError((prev) => (prev ? prev + "\n" + err.message : err.message));
            }

            // Set final progress for this file chunk
            setUploadProgress(Math.round(((i + 1) / files.length) * 100));
        }

        // Reset to page 1 after batch upload to show newest ones at the top seamlessly
        setPage(1);
        await fetchDocuments(1);
        event.target.value = '';
        setTimeout(() => {
            setIsUploading(false);
            setUploadProgress(0);
        }, 800);
    };

    const handleDelete = async (docId: string) => {
        if (!confirm("Delete this document from the store?")) return;
        try {
            await fetch(`/api/stores/${activeStoreId}/documents/${docId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            // Soft-delete from state for swiftness without refreshing paginated data entirely
            setDocuments(prev => prev.filter(d => d.id !== docId));
        } catch (e: any) {
            setError(e.message);
        }
    };

    const formatSize = (bytes?: number | null) => {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="glass-panel" style={{ height: "100%", overflowY: "auto" }}>
            {error && <div style={{ color: "var(--error-color)", marginBottom: "1rem", whiteSpace: "pre-wrap" }}>{error}</div>}

            {!activeStoreId && (
                <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                    Please select a store from the sidebar or create one in the Stores tab.
                </div>
            )}

            {activeStoreId && (
                <>
                    <div className="dropzone" onClick={() => document.getElementById("file-upload")?.click()}>
                        <div className="dropzone-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                        </div>
                        <h3>Upload Documents</h3>
                        <p>Click to browse and upload multiple files of any format</p>
                        {isUploading && (
                            <div style={{ marginTop: "1.5rem", width: "100%" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                                    <span style={{ color: "var(--accent-2)" }}>Uploading {totalFiles} file(s)...</span>
                                    <span style={{ color: "var(--accent-2)" }}>{Math.round(uploadProgress)}%</span>
                                </div>
                                <div style={{ height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden", position: "relative" }}>
                                    <div
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            height: "100%",
                                            background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                                            width: `${uploadProgress}%`,
                                            transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                                            boxShadow: "0 0 10px var(--accent-1)"
                                        }}
                                    />
                                    {/* Pulsing visual animation effect on top of the bar */}
                                    {uploadProgress < 100 && (
                                        <div style={{
                                            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                                            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
                                            animation: "progress 1.5s infinite linear"
                                        }} />
                                    )}
                                </div>
                            </div>
                        )}
                        <input
                            type="file"
                            id="file-upload"
                            style={{ display: "none" }}
                            onChange={handleFileUpload}
                            disabled={isUploading}
                            multiple
                            accept="*"
                        />
                    </div>

                    <h3 style={{ marginTop: "2rem", marginBottom: "1rem" }}>Documents in Store</h3>
                    {documents.length === 0 ? (
                        <p style={{ color: "var(--text-secondary)" }}>No documents found in this store.</p>
                    ) : (
                        <div className="glass-panel" style={{ padding: "0", overflow: "hidden" }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Size</th>
                                        <th>Date Uploaded</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {documents.map((doc) => (
                                        <tr key={doc.id}>
                                            <td>{doc.displayName}</td>
                                            <td>{formatSize(doc.size)}</td>
                                            <td>{new Date(doc.uploadedAt).toLocaleString()}</td>
                                            <td>
                                                <div style={{ display: "flex", gap: "0.5rem" }}>
                                                    <a
                                                        href={`/api/stores/${activeStoreId}/documents/${doc.id}/download?token=${accessToken}`}
                                                        target="_blank"
                                                        className="btn-secondary"
                                                        style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                                                    >
                                                        Download
                                                    </a>
                                                    <button
                                                        onClick={() => handleDelete(doc.id)}
                                                        className="btn-secondary"
                                                        style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", color: "var(--error-color)" }}
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

                    {hasMore && (
                        <div style={{ textAlign: "center", marginTop: "1rem", marginBottom: "3rem" }}>
                            <button className="btn-secondary" onClick={loadMore}>Load More Documents</button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
