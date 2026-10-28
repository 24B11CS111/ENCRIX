-- ====================================================================
-- ENCRIX Phase 32: Realtime Publication Extensions for Team and Invitations
-- Migration: 20261027000000_phase32_realtime_publications.sql
-- ====================================================================

-- Add public.profiles and public.organization_invitations to supabase_realtime publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'profiles'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'organization_invitations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_invitations;
    END IF;
END $$;
