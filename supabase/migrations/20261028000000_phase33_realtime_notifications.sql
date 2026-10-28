-- ============================================================================
-- ENCRIX Phase 33: Supabase Realtime Notification Publication & Replica Identity
-- ============================================================================
-- Ensures durable notification updates broadcast in real-time to active user sessions.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        -- Add notifications table to publication if not already present
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
        END IF;
    END IF;
END $$;

-- Set REPLICA IDENTITY FULL to guarantee update payloads contain all fields
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
