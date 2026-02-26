"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isSignUp, setIsSignUp] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [registrationLocked, setRegistrationLocked] = useState(false);

    useEffect(() => {
        const checkLock = async () => {
            try {
                const res = await fetch("/api/system-config");
                const data = await res.json();
                if (data.registrationLocked) {
                    setRegistrationLocked(true);
                }
            } catch (e) {
                console.error("Failed to check registration lock", e);
            }
        };
        checkLock();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");

        try {
            if (isSignUp) {
                if (registrationLocked) {
                    throw new Error("Registration is currently locked by the administrator.");
                }
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setSuccess("Account created! You can now sign in.");
                setIsSignUp(false);
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                window.location.href = "/";
            }
        } catch (err: any) {
            setError(err.message || "Authentication failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: "100vh",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-color)",
            padding: "1rem"
        }}>
            <div className="glass-panel" style={{
                width: "100%",
                maxWidth: "440px",
                padding: "3rem 2rem",
                display: "flex",
                flexDirection: "column",
                gap: "2rem"
            }}>
                <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                    <div style={{
                        width: "56px",
                        height: "56px",
                        borderRadius: "16px",
                        background: "rgba(34, 197, 94, 0.1)",
                        border: "1px solid rgba(34, 197, 94, 0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 0 20px rgba(34, 197, 94, 0.15)"
                    }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: "var(--accent-1)" }}>
                            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M12 16L16 12L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M8 12H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                    <div>
                        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
                            Welcome to Gemini RAG
                        </h1>
                        <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", fontSize: "0.95rem" }}>
                            {isSignUp ? (registrationLocked ? "Account creation is disabled" : "Create an account to get started") : "Sign in to access your knowledge base"}
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                        <div>
                            <label className="form-label" htmlFor="email">Email Address</label>
                            <input
                                id="email"
                                type="email"
                                className="input-field"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@company.com"
                                required
                            />
                        </div>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                                <label className="form-label" htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
                                {!isSignUp && (
                                    <span style={{ fontSize: "0.85rem", color: "var(--accent-1)", cursor: "pointer" }}>
                                        Forgot?
                                    </span>
                                )}
                            </div>
                            <input
                                id="password"
                                type="password"
                                className="input-field"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                            />
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            padding: "0.85rem",
                            borderRadius: "8px",
                            background: "rgba(239, 68, 68, 0.05)",
                            border: "1px solid rgba(239, 68, 68, 0.2)",
                            color: "var(--error-color)",
                            fontSize: "0.9rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem"
                        }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                            {error}
                        </div>
                    )}

                    {success && (
                        <div style={{
                            padding: "0.85rem",
                            borderRadius: "8px",
                            background: "rgba(16, 185, 129, 0.05)",
                            border: "1px solid rgba(16, 185, 129, 0.2)",
                            color: "var(--success-color)",
                            fontSize: "0.9rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem"
                        }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            {success}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={loading || !email || !password || (isSignUp && registrationLocked)}
                        style={{ width: "100%", padding: "0.85rem", fontSize: "1rem", marginTop: "0.5rem" }}
                    >
                        {loading ? (
                            <div className="typing-indicator">
                                <div className="typing-dot" style={{ background: "#020617" }}></div>
                                <div className="typing-dot" style={{ background: "#020617" }}></div>
                                <div className="typing-dot" style={{ background: "#020617" }}></div>
                            </div>
                        ) : isSignUp ? "Create account" : "Sign in"}
                    </button>
                </form>

                {!registrationLocked && (
                    <div style={{ textAlign: "center", borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem" }}>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                            {isSignUp ? "Already have an account?" : "Don't have an account?"}&nbsp;
                            <button
                                onClick={() => { setIsSignUp(!isSignUp); setError(""); setSuccess(""); }}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--text-primary)",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    fontSize: "0.95rem",
                                    padding: "0.25rem",
                                    transition: "text-shadow 0.2s"
                                }}
                                onMouseOver={e => e.currentTarget.style.textShadow = "0 0 10px rgba(255,255,255,0.3)"}
                                onMouseOut={e => e.currentTarget.style.textShadow = "none"}
                            >
                                {isSignUp ? "Sign in" : "Sign up"}
                            </button>
                        </p>
                    </div>
                )}

                {registrationLocked && !isSignUp && (
                    <div style={{ textAlign: "center", borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem" }}>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                            Registration is currently closed.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
