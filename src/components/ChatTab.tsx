import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Icons
const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
);
const UserIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" /></svg>
);
const AIIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z" clipRule="evenodd" /></svg>
);
const DocIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625zM7.5 15a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5A.75.75 0 017.5 15zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H8.25z" clipRule="evenodd" /></svg>
);

const TypewriterText = ({ content, speed = 15 }: { content: string, speed?: number }) => {
    const [displayedContent, setDisplayedContent] = useState('');

    useEffect(() => {
        let i = 0;
        // eslint-disable-next-line
        setDisplayedContent('');
        // Dynamic speed based on text length to avoid extremely long animations
        const charsPerTick = Math.max(1, Math.floor(content.length / 300));

        const timer = setInterval(() => {
            i += charsPerTick;
            setDisplayedContent(content.substring(0, i));
            if (i >= content.length) {
                clearInterval(timer);
            }
        }, speed);

        return () => clearInterval(timer);
    }, [content, speed]);

    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayedContent}</ReactMarkdown>;
};

export default function ChatTab({ activeStoreId, accessToken }: { activeStoreId: string; accessToken: string }) {
    const [messages, setMessages] = useState<any[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const authHeaders = () => ({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" });

    useEffect(() => {
        fetchHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo(0, scrollRef.current.scrollHeight);
        }
    }, [messages, isLoading]);

    const fetchHistory = async () => {
        try {
            const res = await fetch("/api/state", { headers: authHeaders() });
            const data = await res.json();
            setMessages(data.chatHistory || []);
        } catch (e) {
            console.error("Failed to load history", e);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput("");
        setIsLoading(true);

        setMessages(prev => [...prev, { role: "user", content: userMsg }]);

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                    message: userMsg,
                    storeIds: activeStoreId ? [activeStoreId] : []
                })
            });

            const data = await res.json();

            // Handle specific quota error
            if (res.status === 429 || data.error === "QUOTA_EXCEEDED") {
                setMessages(prev => [...prev, {
                    role: "model",
                    content: `**Quota Exceeded ⚠️**\n\n${data.message || "You have exceeded your Gemini API limits. Free tier allows 15 Requests Per minute."}`
                }]);
                return;
            }

            if (data.history) {
                setMessages(data.history);
            } else {
                throw new Error(data.error || "Unknown error");
            }
        } catch (error: any) {
            console.error("Chat Error:", error);
            setMessages(prev => [...prev, { role: "model", content: `**Error:** Failed to get response. ${error.message || ""}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = async () => {
        try {
            await fetch("/api/state", { method: "DELETE", headers: authHeaders() });
            setMessages([]);
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div className="chat-container glass-panel">
            <div className="chat-history" ref={scrollRef}>
                {messages.length === 0 && (
                    <div style={{ textAlign: "center", color: "var(--text-secondary)", marginTop: "auto", marginBottom: "auto" }}>
                        <h3 className="shiny-text">Start your workflow</h3>
                        <p style={{ marginTop: "0.5rem" }}>Select a store from the sidebar and begin asking questions.</p>
                    </div>
                )}

                {messages.map((m, i) => (
                    <div key={m.id || i} className={`message message-${m.role === "model" ? "assistant" : "user"}`}>
                        <div className={`avatar avatar-${m.role === "model" ? "assistant" : "user"}`}>
                            {m.role === "user" ? <UserIcon /> : <AIIcon />}
                        </div>
                        <div className="message-content">
                            {m.role === "model" && i === messages.length - 1 ? (
                                <TypewriterText content={m.content} />
                            ) : (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                            )}

                            {m.citations && m.citations.length > 0 && (
                                <div className="citations">
                                    <p style={{ marginBottom: "0.5rem", fontWeight: 600 }}>Sources:</p>
                                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                        {m.citations.map((c: any, idx: number) => (
                                            c.uri ? (
                                                <a key={idx} href={c.uri} target="_blank" rel="noreferrer" className="citation-title">
                                                    <DocIcon /> {c.title}
                                                </a>
                                            ) : (
                                                <div key={idx} className="citation-title">
                                                    <DocIcon /> {c.title}
                                                </div>
                                            )
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="message message-assistant">
                        <div className="avatar avatar-assistant"><AIIcon /></div>
                        <div className="message-content" style={{ display: 'flex', alignItems: 'center' }}>
                            <div className="typing-indicator">
                                <div className="typing-dot"></div>
                                <div className="typing-dot"></div>
                                <div className="typing-dot"></div>
                            </div>
                            <span style={{ marginLeft: "0.75rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>Computing response...</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="chat-input-area">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem", padding: "0 0.5rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Dataset: <span style={{ color: "var(--accent-1)" }}>{activeStoreId || "None selected"}</span>
                    </span>
                    <button onClick={handleClear} style={{ background: "none", border: "none", color: "var(--error-color)", fontSize: "0.85rem", opacity: 0.8, cursor: "pointer" }}>
                        Clear session
                    </button>
                </div>
                <div className="chat-input-wrapper">
                    <input
                        type="text"
                        className="chat-input"
                        placeholder="Message your knowledge base..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    />
                    <button
                        className="btn-send"
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                    >
                        <SendIcon />
                    </button>
                </div>
            </div>
        </div>
    );
}
