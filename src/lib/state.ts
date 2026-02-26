import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

export interface ChatMessage {
    id: string;
    role: "user" | "model";
    content: string;
    citations?: Citation[];
    timestamp: string;
}

export interface Citation {
    title: string;
    startIndex?: number;
    endIndex?: number;
    chunk?: string;
}

export interface StoreRecord {
    id: string;
    name: string;
    displayName: string;
    createdAt: string;
    documentCount: number;
}

export interface DocumentRecord {
    id: string;
    storeId: string;
    name: string;
    displayName: string;
    originalFilename: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
    localPath: string;
    metadata?: Record<string, string>;
}

export interface AppState {
    stores: StoreRecord[];
    documents: DocumentRecord[];
    chatHistory: ChatMessage[];
    systemPrompt: string;
    activeStoreId: string | null;
    activeModel: string;
    mcpConfig: {
        apiKey: string;
    };
    usage: {
        totalTokens: number;
        estimatedCost: number; // in USD
    };
    chunkingConfig: {
        maxTokensPerChunk: number;
        maxOverlapTokens: number;
    };
}

const DEFAULT_STATE: AppState = {
    stores: [],
    documents: [],
    chatHistory: [],
    systemPrompt:
        "You are a helpful AI assistant. Answer questions based on the provided documents. Always cite your sources when possible. Format your responses using Markdown.",
    activeStoreId: null,
    activeModel: "gemini-2.5-flash",
    mcpConfig: {
        apiKey: "",
    },
    usage: {
        totalTokens: 0,
        estimatedCost: 0,
    },
    chunkingConfig: {
        maxTokensPerChunk: 512,
        maxOverlapTokens: 50,
    },
};

function ensureDirectories() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR))
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function loadState(): AppState {
    ensureDirectories();
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, "utf-8");
            return { ...DEFAULT_STATE, ...JSON.parse(raw) };
        }
    } catch {
        console.error("Failed to load state, using defaults");
    }
    return { ...DEFAULT_STATE };
}

export function saveState(state: AppState): void {
    ensureDirectories();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function getUploadsDir(): string {
    ensureDirectories();
    return UPLOADS_DIR;
}

export function updateState(updater: (state: AppState) => AppState): AppState {
    const state = loadState();
    const newState = updater(state);
    saveState(newState);
    return newState;
}
