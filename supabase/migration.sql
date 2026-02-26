-- ===========================================
-- RAG Application: Supabase Migration
-- Run this in Supabase SQL Editor
-- ===========================================

-- 1. Stores table
CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    document_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own stores"
    ON stores FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stores"
    ON stores FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stores"
    ON stores FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own stores"
    ON stores FOR DELETE
    USING (auth.uid() = user_id);

-- 2. Documents table
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER DEFAULT 0,
    local_path TEXT,
    metadata JSONB DEFAULT '{}',
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own documents"
    ON documents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
    ON documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
    ON documents FOR DELETE
    USING (auth.uid() = user_id);

-- 3. Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
    ON chat_messages FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages"
    ON chat_messages FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages"
    ON chat_messages FOR DELETE
    USING (auth.uid() = user_id);

-- 4. User settings table (one row per user)
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    system_prompt TEXT DEFAULT 'You are a helpful AI assistant. Answer questions based on the provided documents. Always cite your sources when possible. Format your responses using Markdown.',
    active_store_id TEXT,
    active_model TEXT DEFAULT 'gemini-2.5-flash',
    mcp_api_key TEXT DEFAULT '',
    total_tokens INTEGER DEFAULT 0,
    estimated_cost NUMERIC(12, 8) DEFAULT 0,
    chunking_max_tokens INTEGER DEFAULT 512,
    chunking_max_overlap INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
    ON user_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
    ON user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
    ON user_settings FOR UPDATE
    USING (auth.uid() = user_id);

-- 5. Auto-create user_settings row on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 6. MCP API Keys table (multiple keys per user)
CREATE TABLE IF NOT EXISTS mcp_api_keys (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_value TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT 'Default Key',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mcp keys"
    ON mcp_api_keys FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mcp keys"
    ON mcp_api_keys FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mcp keys"
    ON mcp_api_keys FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mcp keys"
    ON mcp_api_keys FOR DELETE
    USING (auth.uid() = user_id);

-- Allow anon (MCP server) to SELECT active keys for validation
CREATE POLICY "Anon can validate active keys"
    ON mcp_api_keys FOR SELECT
    USING (is_active = true);

-- Allow anon (MCP server) to UPDATE last_used_at on active keys
CREATE POLICY "Anon can update last_used_at"
    ON mcp_api_keys FOR UPDATE
    USING (is_active = true)
    WITH CHECK (is_active = true);

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stores_user ON stores(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_store ON documents(store_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_user ON mcp_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_value ON mcp_api_keys(key_value);
