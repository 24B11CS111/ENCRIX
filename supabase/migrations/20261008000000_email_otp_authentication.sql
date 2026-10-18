-- ====================================================================
-- ENCRIX Phase 15.2: Email OTP Authentication & Verified Onboarding
-- Migration: 20261008000000_email_otp_authentication.sql
-- ====================================================================

-- 1. EXTEND PROFILES FOR EMAIL VERIFICATION
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_email_verified ON public.profiles(email_verified);

-- 2. CREATE EMAIL OTPS TABLE (Server-Side Email OTP Lifecycle Tracking)
CREATE TABLE IF NOT EXISTS public.email_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    purpose VARCHAR(50) NOT NULL CHECK (purpose IN ('LOGIN', 'REGISTER', 'INVITATION')),
    otp_hash VARCHAR(255) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    resend_after TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON public.email_otps(email, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_email_otps_expires ON public.email_otps(expires_at);

ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

-- Strictly server-only: client-side cannot read or modify OTP records directly
CREATE POLICY "Service role only access to email_otps"
    ON public.email_otps
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 3. ENSURE EMAIL INDEXING & CONSTRAINTS ON INVITATIONS & PENDING REGISTRATIONS
ALTER TABLE public.organization_invitations ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE public.pending_registrations ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE public.pending_registrations DROP CONSTRAINT IF EXISTS pending_registrations_phone_number_key;

CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON public.organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_pending_reg_email ON public.pending_registrations(email);

