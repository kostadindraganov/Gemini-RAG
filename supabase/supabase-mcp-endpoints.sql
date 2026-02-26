CREATE TABLE mcp_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users NOT NULL,
    url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE mcp_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own endpoints" 
    ON mcp_endpoints 
    FOR ALL 
    USING (auth.uid() = user_id);
