"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import ChatTab from "@/components/ChatTab";
import DocumentsTab from "@/components/DocumentsTab";
import StoresTab from "@/components/StoresTab";
import ApiDocsTab from "@/components/ApiDocsTab";
import McpTestingTab from "@/components/McpTestingTab";
import SettingsTab from "@/components/SettingsTab";
import UserMenu from "@/components/UserMenu";
import type { Session } from "@supabase/supabase-js";

type Tab = "chat" | "docs" | "stores" | "api" | "mcp-test" | "settings";

// SVG Icons (Heroicons/Lucide inspired)
const MenuIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
);
const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
);
const ChatIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
);
const DocsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
);
const StoresIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
);
const ApiIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
);
const TestIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
);
const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
);
const LogoutIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
);

export default function Home() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>("chat");
    const [activeStoreId, setActiveStoreId] = useState<string>("");
    const [activeModel, setActiveModel] = useState<string>("gemini-2.5-pro");
    const [accountTier, setAccountTier] = useState<string>("free");
    const [stores, setStores] = useState<any[]>([]);
    const [usage, setUsage] = useState({ totalTokens: 0, estimatedCost: 0 });
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
            if (session) fetchStores(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (session) fetchStores(session);
        });

        // Deep linking: switch tab if ?tab= provided
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab");
        if (tab === "docs" || tab === "stores" || tab === "api" || tab === "mcp-test" || tab === "settings") {
            setActiveTab(tab as Tab);
        }

        return () => subscription.unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const authHeaders = (): Record<string, string> => {
        if (!session?.access_token) return { "Content-Type": "application/json" };
        return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
    };

    async function fetchStores(sess?: Session) {
        const s = sess || session;
        if (!s) return;
        try {
            const res = await fetch("/api/state", {
                headers: { Authorization: `Bearer ${s.access_token}` }
            });
            const data = await res.json();
            setStores(data.stores || []);
            if (data.stores?.length > 0 && !activeStoreId && !data.activeStoreId) {
                setActiveStoreId(data.stores[0].id);
            } else if (data.activeStoreId) {
                setActiveStoreId(data.activeStoreId);
            }
            if (data.activeModel) setActiveModel(data.activeModel);
            if (data.accountTier) setAccountTier(data.accountTier);
            if (data.usage) setUsage(data.usage);
        } catch (e) {
            console.error(e);
        }
    }

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    if (loading) {
        return (
            <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-color)" }}>
                <div className="typing-indicator">
                    <div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div>
                </div>
            </div>
        );
    }

    if (!session) {
        if (typeof window !== "undefined") window.location.assign("/login");
        return null;
    }

    const switchTab = (tab: Tab) => {
        setActiveTab(tab);
        setIsSidebarOpen(false); // Auto-close on mobile when tab changes
    };

    return (
        <div className="app-container">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 35, backdropFilter: "blur(4px)" }}
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <aside className={`sidebar ${isSidebarOpen ? 'mobile-open' : ''}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="brand">
                        <img
                            src="/favicon.png"
                            alt="Gemini RAG Logo"
                            style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "6px",
                                objectFit: "cover"
                            }}
                        />
                        Gemini RAG
                    </div>
                    {/* Close button — always rendered, hidden on desktop via .sidebar-close-btn CSS */}
                    <button
                        className="mobile-menu-btn sidebar-close-btn"
                        onClick={() => setIsSidebarOpen(false)}
                        style={{ display: 'none' }}
                        aria-label="Close sidebar"
                    >
                        <CloseIcon />
                    </button>
                </div>

                <nav className="nav-menu">
                    <button className={`nav-item ${activeTab === "chat" ? "active" : ""}`} onClick={() => switchTab("chat")}>
                        <ChatIcon /> Chat interface
                    </button>
                    <button className={`nav-item ${activeTab === "docs" ? "active" : ""}`} onClick={() => switchTab("docs")}>
                        <DocsIcon /> Documents
                    </button>
                    <button className={`nav-item ${activeTab === "stores" ? "active" : ""}`} onClick={() => switchTab("stores")}>
                        <StoresIcon /> Stores
                    </button>
                    <button className={`nav-item ${activeTab === "api" ? "active" : ""}`} onClick={() => switchTab("api")}>
                        <ApiIcon /> API Docs
                    </button>
                    <button className={`nav-item ${activeTab === "mcp-test" ? "active" : ""}`} onClick={() => switchTab("mcp-test")}>
                        <TestIcon /> MCP Testing
                    </button>
                </nav>

                <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Active Store</label>
                        <select
                            className="input-field"
                            value={activeStoreId}
                            onChange={async e => {
                                setActiveStoreId(e.target.value);
                                await fetch("/api/state", {
                                    method: "POST",
                                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                                    body: JSON.stringify({ activeStoreId: e.target.value })
                                });
                            }}
                        >
                            <option value="">No store selected</option>
                            {stores.map(s => (
                                <option key={s.id} value={s.id}>{s.displayName}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Language Model</label>
                        <select
                            className="input-field"
                            value={activeModel}
                            onChange={async (e) => {
                                setActiveModel(e.target.value);
                                await fetch("/api/state", {
                                    method: "POST",
                                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                                    body: JSON.stringify({ activeModel: e.target.value })
                                });
                            }}
                        >
                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                            <option value="gemini-3-pro-preview">Gemini 3 Pro Preview</option>
                            <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                        </select>
                    </div>

                    <button
                        className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
                        onClick={() => switchTab("settings")}
                        style={{ padding: "0.75rem", border: "1px solid var(--border-color)" }}
                    >
                        <SettingsIcon /> Settings & MCP
                    </button>

                    <UserMenu email={session.user.email || ""} accessToken={session.access_token || ""} onLogout={handleLogout} />
                </div>
            </aside>

            <main className="main-content">
                <header className="header">
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)}>
                            <MenuIcon />
                        </button>
                        <h2 className="header-title">
                            {activeTab === "docs" && "Document Management"}
                            {activeTab === "stores" && "File Search Stores"}
                            {activeTab === "api" && "API Integration"}
                            {activeTab === "mcp-test" && "MCP Testing Tool"}
                            {activeTab === "settings" && "Platform Settings"}
                        </h2>
                    </div>

                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {/* Account Tier Badge */}
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            background: accountTier === 'paid' || accountTier === 'tier1' ? "rgba(59, 130, 246, 0.1)" : "rgba(255, 255, 255, 0.05)",
                            border: `1px solid ${accountTier === 'paid' || accountTier === 'tier1' ? "rgba(59, 130, 246, 0.3)" : "var(--border-color)"}`,
                            borderRadius: "20px",
                            padding: "0.3rem 0.75rem",
                            color: accountTier === 'paid' || accountTier === 'tier1' ? "var(--accent-3)" : "var(--text-secondary)",
                            fontWeight: 700,
                            fontSize: "0.72rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em"
                        }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: accountTier === 'paid' || accountTier === 'tier1' ? "var(--accent-3)" : "var(--text-muted)" }} />
                            {accountTier === 'paid' || accountTier === 'tier1' ? "Pro Tier" : "Free Tier"}
                        </div>

                        {/* Active model badge - hidden on very small screens to save space */}
                        <span className="header-model-badge" style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.25)", borderRadius: "20px", padding: "0.3rem 0.75rem", color: "var(--accent-1)", fontWeight: 600, fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                            {activeModel}
                        </span>

                        {/* Usage stats */}
                        <div className="header-stats" style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "rgba(0,0,0,0.2)", padding: "0.3rem 0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)", fontSize: "0.8rem" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "var(--text-secondary)" }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM13 17h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
                                {usage.totalTokens.toLocaleString()}
                            </span>
                            <span style={{ color: "var(--accent-2)", fontWeight: 600 }}>${(usage.estimatedCost || 0).toFixed(4)}</span>
                        </div>
                    </div>
                </header>

                <div className="tab-content">
                    {activeTab === "chat" && <ChatTab activeStoreId={activeStoreId} accessToken={session.access_token} />}
                    {activeTab === "docs" && <DocumentsTab activeStoreId={activeStoreId} accessToken={session.access_token} />}
                    {activeTab === "stores" && (
                        <StoresTab
                            onStoresChange={fetchStores}
                            stores={stores}
                            accessToken={session.access_token}
                            accountTier={accountTier}
                            onSelectStore={(id) => {
                                setActiveStoreId(id);
                                // Also update on server
                                fetch("/api/state", {
                                    method: "POST",
                                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                                    body: JSON.stringify({ activeStoreId: id })
                                });
                            }}
                            onSwitchTab={switchTab}
                        />
                    )}
                    {activeTab === "api" && <ApiDocsTab />}
                    {activeTab === "mcp-test" && <McpTestingTab />}
                    {activeTab === "settings" && <SettingsTab accessToken={session.access_token} accountTier={accountTier} onTierChange={setAccountTier} />}
                </div>
            </main>
        </div>
    );
}
