"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface UserMenuProps {
    email: string;
    accessToken: string;
    onLogout: () => void;
}

function getInitials(email: string) {
    const parts = email.split("@")[0].split(/[._\-]/);
    return parts.slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || email[0]?.toUpperCase() || "U";
}

function getAvatarColor(email: string) {
    const colors = [
        ["#22c55e", "#16a34a"],
        ["#3b82f6", "#2563eb"],
        ["#a855f7", "#9333ea"],
        ["#f59e0b", "#d97706"],
        ["#ec4899", "#db2777"],
        ["#06b6d4", "#0891b2"],
    ];
    let hash = 0;
    for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) % colors.length;
    return colors[Math.abs(hash)];
}

export default function UserMenu({ email, accessToken, onLogout }: UserMenuProps) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<"menu" | "password">("menu");
    const [currentPw, setCurrentPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [pwLoading, setPwLoading] = useState(false);
    const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);
    const [copied, setCopied] = useState(false);
    const [tierInfo, setTierInfo] = useState<{ label: string; paid: boolean } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const tierFetched = useRef(false);

    const initials = getInitials(email);
    const [fromColor, toColor] = getAvatarColor(email);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
                setView("menu");
            }
        };
        if (open) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    // Fetch tier once on first open
    useEffect(() => {
        if (!open || tierFetched.current) return;
        tierFetched.current = true;
        fetch("/api/account-tier", {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
        })
            .then(r => r.json())
            .then(d => {
                if (!d.error) setTierInfo({ label: d.label, paid: d.tier === "paid" });
            })
            .catch(() => { });
    }, [open]);

    const handleCopyEmail = () => {
        navigator.clipboard.writeText(email);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleChangePassword = async () => {
        setPwMsg(null);
        if (!newPw || !confirmPw) {
            setPwMsg({ text: "Please fill in all fields.", ok: false });
            return;
        }
        if (newPw !== confirmPw) {
            setPwMsg({ text: "Passwords do not match.", ok: false });
            return;
        }
        if (newPw.length < 8) {
            setPwMsg({ text: "Password must be at least 8 characters.", ok: false });
            return;
        }
        setPwLoading(true);
        const { error } = await supabase.auth.updateUser({ password: newPw });
        setPwLoading(false);
        if (error) {
            setPwMsg({ text: error.message, ok: false });
        } else {
            setPwMsg({ text: "✓ Password updated successfully.", ok: true });
            setCurrentPw(""); setNewPw(""); setConfirmPw("");
            setTimeout(() => { setOpen(false); setView("menu"); setPwMsg(null); }, 1800);
        }
    };

    return (
        <div ref={menuRef} style={{ position: "relative", paddingTop: "1rem", borderTop: "1px solid var(--border-color)" }}>
            {/* Trigger button */}
            <button
                onClick={() => { setOpen(o => !o); setView("menu"); }}
                style={{
                    display: "flex", alignItems: "center", gap: "0.75rem",
                    width: "100%", background: open ? "rgba(255,255,255,0.06)" : "transparent",
                    border: "1px solid transparent", borderRadius: "10px",
                    padding: "0.55rem 0.65rem", cursor: "pointer",
                    transition: "background 0.2s ease, border-color 0.2s ease",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-color)"; }}
                onMouseLeave={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; } }}
            >
                {/* Avatar */}
                <span style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${fromColor}, ${toColor})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.75rem", fontWeight: 700, color: "#fff", letterSpacing: 0,
                }}>
                    {initials}
                </span>
                {/* Email */}
                <span style={{
                    flex: 1, fontSize: "0.8rem", color: "var(--text-secondary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    textAlign: "left",
                }}>
                    {email}
                </span>
                {/* Chevron */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    style={{ color: "var(--text-muted)", flexShrink: 0, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}>
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {/* Popover */}
            {open && (
                <div style={{
                    position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0,
                    background: "var(--bg-panel)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", boxShadow: "0 -8px 32px rgba(0,0,0,0.4)",
                    overflow: "hidden", zIndex: 100,
                    animation: "fadeSlideUp 0.15s ease",
                }}>
                    {view === "menu" ? (
                        <>
                            {/* Header */}
                            <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                <span style={{
                                    width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                                    background: `linear-gradient(135deg, ${fromColor}, ${toColor})`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: "0.9rem", fontWeight: 700, color: "#fff",
                                }}>
                                    {initials}
                                </span>
                                <div style={{ overflow: "hidden", flex: 1 }}>
                                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "1px" }}>Signed in as</div>
                                    <div style={{ fontSize: "0.83rem", color: "var(--text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>
                                    {/* Tier badge */}
                                    {tierInfo && (
                                        <div style={{ marginTop: "4px" }}>
                                            <span style={{
                                                display: "inline-flex", alignItems: "center", gap: "3px",
                                                fontSize: "0.68rem", fontWeight: 600,
                                                padding: "1px 7px", borderRadius: "10px",
                                                background: tierInfo.paid ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
                                                color: tierInfo.paid ? "var(--accent-1)" : "#eab308",
                                                border: `1px solid ${tierInfo.paid ? "rgba(34,197,94,0.3)" : "rgba(234,179,8,0.35)"}`,
                                            }}>
                                                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                                                {tierInfo.label}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ padding: "0.4rem" }}>
                                <MenuItem
                                    icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
                                    label="Change Password"
                                    onClick={() => { setView("password"); setPwMsg(null); }}
                                />
                                <MenuItem
                                    icon={
                                        copied
                                            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>
                                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                                    }
                                    label={copied ? "Email copied!" : "Copy Email"}
                                    onClick={handleCopyEmail}
                                />
                                <div style={{ margin: "0.3rem 0", height: 1, background: "var(--border-color)" }} />
                                <MenuItem
                                    icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                    label="Sign Out"
                                    onClick={onLogout}
                                    danger
                                />
                            </div>
                        </>
                    ) : (
                        /* Change Password view */
                        <div style={{ padding: "1rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                                <button
                                    onClick={() => { setView("menu"); setPwMsg(null); }}
                                    style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "2px", display: "flex", alignItems: "center" }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </button>
                                <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)" }}>Change Password</span>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                <PasswordInput
                                    placeholder="New password"
                                    value={newPw}
                                    onChange={setNewPw}
                                />
                                <PasswordInput
                                    placeholder="Confirm new password"
                                    value={confirmPw}
                                    onChange={setConfirmPw}
                                />
                            </div>

                            {pwMsg && (
                                <p style={{ fontSize: "0.78rem", marginTop: "0.6rem", color: pwMsg.ok ? "var(--accent-1)" : "var(--error-color)", lineHeight: 1.4 }}>
                                    {pwMsg.text}
                                </p>
                            )}

                            <button
                                onClick={handleChangePassword}
                                disabled={pwLoading}
                                className="btn-primary"
                                style={{ width: "100%", marginTop: "0.75rem", justifyContent: "center" }}
                            >
                                {pwLoading ? "Updating…" : "Update Password"}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

function MenuItem({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
    const [hover, setHover] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: "flex", alignItems: "center", gap: "0.65rem",
                width: "100%", padding: "0.55rem 0.7rem", borderRadius: "8px",
                background: hover ? (danger ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.06)") : "transparent",
                border: "none", cursor: "pointer", textAlign: "left",
                color: danger ? (hover ? "#ef4444" : "var(--text-secondary)") : "var(--text-secondary)",
                fontSize: "0.83rem", fontWeight: 500,
                transition: "background 0.15s ease, color 0.15s ease",
            }}
        >
            <span style={{ color: danger && hover ? "#ef4444" : "var(--text-muted)", flexShrink: 0, display: "flex" }}>{icon}</span>
            {label}
        </button>
    );
}

function PasswordInput({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
    const [show, setShow] = useState(false);
    return (
        <div style={{ position: "relative" }}>
            <input
                type={show ? "text" : "password"}
                placeholder={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                className="input-field"
                style={{ paddingRight: "2.5rem", fontSize: "0.83rem" }}
            />
            <button
                onClick={() => setShow(s => !s)}
                tabIndex={-1}
                style={{
                    position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--text-muted)", display: "flex", alignItems: "center", padding: "4px",
                }}
            >
                {show
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                }
            </button>
        </div>
    );
}
