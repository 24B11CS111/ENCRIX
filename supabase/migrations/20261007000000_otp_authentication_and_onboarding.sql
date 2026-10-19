-- ====================================================================
-- ENCRIX Phase 15: OTP-First Authentication & Verified Onboarding
-- Migration: 20261007000000_otp_authentication_and_onboarding.sql
-- ====================================================================

-- 1. EXTEND PROFILES FOR PHONE VERIFICATION AND EXTENDED STATUSES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Update status check constraint to support PENDING_VERIFICATION, SUSPENDED, ACTIVE, DISABLED, PENDING
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check CHECK (
    status IN ('ACTIVE', 'DISABLED', 'PENDING', 'PENDING_VERIFICATION', 'SUSPENDED')
);

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_phone_verified ON public.profiles(phone_verified);

-- 2. ORGANIZATION INVITATIONS TABLE (Tenant-Scoped Telecaller Invitations)
CREATE TABLE IF NOT EXISTS public.organization_invitations (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'TELECALLER' CHECK (role = 'TELECALLER'),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
    token VARCHAR(100) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for invitation queries
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_status ON public.organization_invitations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON public.organization_invitations(token);
CREATE INDEX IF NOT EXISTS idx_org_invitations_phone ON public.organization_invitations(phone_number);

-- Enable RLS on organization_invitations
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

-- Admins can view and manage all invitations
CREATE POLICY "Admins can view and manage all invitations"
    ON public.organization_invitations
    FOR ALL
    USING (public.get_auth_role() = 'ADMIN');

-- Owners can view and manage invitations within their own organization
CREATE POLICY "Owners manage org invitations"
    ON public.organization_invitations
    FOR ALL
    USING (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() = 'OWNER'
    );

-- Telecallers CANNOT view or manipulate organization invitations
CREATE POLICY "Telecallers cannot access invitations"
    ON public.organization_invitations
    FOR ALL
    USING (false);

-- Service role has full access for backend registration & verification tasks
CREATE POLICY "Service role full access on organization_invitations"
    ON public.organization_invitations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 3. PENDING REGISTRATIONS TABLE (Server-Only Pending Owner Registrations)
CREATE TABLE IF NOT EXISTS public.pending_registrations (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    phone_number VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    owner_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    industry VARCHAR(100) DEFAULT 'General',
    company_size VARCHAR(50) DEFAULT '1-10',
    otp_hash VARCHAR(255) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    resend_after TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_reg_phone ON public.pending_registrations(phone_number);
CREATE INDEX IF NOT EXISTS idx_pending_reg_expires ON public.pending_registrations(expires_at);

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;

-- Strictly server-only: anon and authenticated cannot access pending registrations directly
CREATE POLICY "Service role only access to pending_registrations"
    ON public.pending_registrations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4. PHONE OTPS TABLE (Server-Side OTP Lifecycle Tracking)
CREATE TABLE IF NOT EXISTS public.phone_otps (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    phone_number VARCHAR(50) NOT NULL,
    purpose VARCHAR(50) NOT NULL CHECK (purpose IN ('LOGIN', 'REGISTER', 'INVITATION')),
    otp_hash VARCHAR(255) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    resend_after TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone_purpose ON public.phone_otps(phone_number, purpose, used);
CREATE INDEX IF NOT EXISTS idx_phone_otps_expires ON public.phone_otps(expires_at);

ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only access to phone_otps"
    ON public.phone_otps
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
