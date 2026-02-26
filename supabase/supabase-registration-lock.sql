-- ===========================================
-- RAG Application: Registration Lock (FUNCTIONAL)
-- ===========================================

-- 1. System config table for global settings
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed registration lock status (default: unlocked/off)
INSERT INTO system_config (key, value)
VALUES ('registration_locked', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view and update
CREATE POLICY "Auth users can view config"
    ON system_config FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Auth users can update config"
    ON system_config FOR UPDATE
    TO authenticated
    USING (true);

-- Allow public (anon) to see if registration is locked
CREATE POLICY "Public can view registration lock"
    ON system_config FOR SELECT
    TO anon
    USING (key = 'registration_locked');

-- 2. Function to count users safely (Security Definer avoids RLS)
CREATE OR REPLACE FUNCTION get_registered_user_count()
RETURNS TABLE (count bigint) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY SELECT count(*) FROM auth.users;
END;
$$;

-- 3. Trigger Function to block new user registration if locked
CREATE OR REPLACE FUNCTION check_new_user_registration()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_locked BOOLEAN;
    user_count BIGINT;
BEGIN
    -- 1. Always permit if the action comes from a service/admin role
    -- This allows dashboard invitations and manual admin work to bypass the lock
    IF current_setting('role', true) IN ('service_role', 'supabase_admin', 'postgres') THEN
        RETURN NEW;
    END IF;

    -- 2. Get current lock status (default to FALSE if not found or error)
    BEGIN
        SELECT (value::boolean) INTO is_locked 
        FROM public.system_config 
        WHERE key = 'registration_locked';
    EXCEPTION WHEN OTHERS THEN
        is_locked := FALSE;
    END;

    -- 3. Count existing users
    SELECT count(*) INTO user_count FROM auth.users;

    -- 4. Only block if locked AND at least one user already exists
    -- This ensures the very first user can always sign up
    IF is_locked IS TRUE AND user_count > 0 THEN
        RAISE EXCEPTION 'Registration is currently locked by the administrator.';
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Apply trigger to auth.users (Before Insert)
DROP TRIGGER IF EXISTS tr_check_registration_lock ON auth.users;
CREATE TRIGGER tr_check_registration_lock
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION check_new_user_registration();
