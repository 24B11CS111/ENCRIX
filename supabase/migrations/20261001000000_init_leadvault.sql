-- LEADVAULT: Master Production Database Schema & RLS Policies
-- Multi-Tenant Secure Telecaller CRM
-- Extension: UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- 1. ORGANIZATIONS
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    owner_id UUID NOT NULL,
    industry VARCHAR(100) DEFAULT 'General',
    company_size VARCHAR(50) DEFAULT '1-10',
    logo_url TEXT,
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TRIAL')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PROFILES (Extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'OWNER', 'TELECALLER')),
    avatar_url TEXT,
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'PENDING')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. LEADS
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    source VARCHAR(100) DEFAULT 'Direct',
    status VARCHAR(50) DEFAULT 'NEW' CHECK (
        status IN (
            'NEW',
            'ASSIGNED',
            'CONTACTED',
            'INTERESTED',
            'FOLLOW_UP',
            'CONVERTED',
            'NOT_INTERESTED',
            'INVALID',
            'DO_NOT_CONTACT'
        )
    ),
    priority VARCHAR(50) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. LEAD ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.lead_assignments (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    unassigned_at TIMESTAMPTZ
);

-- 5. CALLS
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    telecaller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider VARCHAR(50) DEFAULT 'MOCK',
    provider_call_id VARCHAR(150),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'COMPLETED' CHECK (
        status IN ('INITIATED', 'RINGING', 'CONNECTED', 'COMPLETED', 'MISSED', 'BUSY', 'FAILED')
    ),
    recording_url TEXT,
    recording_consent BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. CALL OUTCOMES
CREATE TABLE IF NOT EXISTS public.call_outcomes (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    telecaller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    outcome VARCHAR(50) NOT NULL CHECK (
        outcome IN (
            'POSITIVE',
            'NEGATIVE',
            'NO_ANSWER',
            'BUSY',
            'CALL_BACK',
            'WRONG_NUMBER',
            'DO_NOT_CONTACT',
            'CONVERTED',
            'FOLLOW_UP'
        )
    ),
    reason TEXT,
    interest_level VARCHAR(50),
    requirement TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. FOLLOW UPS
CREATE TABLE IF NOT EXISTS public.follow_ups (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    assigned_to UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'MISSED', 'CANCELLED')),
    priority VARCHAR(50) DEFAULT 'MEDIUM',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. SECURITY EVENTS
CREATE TABLE IF NOT EXISTS public.security_events (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. USER SESSIONS / AUDIT
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    last_login TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    ip_address VARCHAR(100),
    user_agent TEXT,
    failed_attempts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_leads_org_assigned ON public.leads(organization_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON public.leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_calls_org_telecaller ON public.calls(organization_id, telecaller_id);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON public.calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_sched ON public.follow_ups(assigned_to, scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_activity_org_created ON public.activity_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_org_severity ON public.security_events(organization_id, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);

-- HELPER FUNCTIONS FOR RLS
CREATE OR REPLACE FUNCTION public.get_auth_profile()
RETURNS public.profiles AS $$
  SELECT * FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS VARCHAR AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_auth_org_id()
RETURNS UUID AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- POLICIES: ORGANIZATIONS
CREATE POLICY "Admin can view all orgs" ON public.organizations
    FOR ALL USING (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Users can view their own org" ON public.organizations
    FOR SELECT USING (id = public.get_auth_org_id());

CREATE POLICY "Owners can update their own org" ON public.organizations
    FOR UPDATE USING (id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER');

-- POLICIES: PROFILES
CREATE POLICY "Admins can view and manage all profiles" ON public.profiles
    FOR ALL USING (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Users can view profiles in their own org" ON public.profiles
    FOR SELECT USING (organization_id = public.get_auth_org_id());

CREATE POLICY "Owners can manage profiles in their org" ON public.profiles
    FOR ALL USING (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER');

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (user_id = auth.uid());

-- POLICIES: LEADS (CRITICAL DATA ISOLATION)
CREATE POLICY "Admins view org leads" ON public.leads
    FOR ALL USING (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Owners manage org leads" ON public.leads
    FOR ALL USING (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER');

-- TELECALLER CAN ONLY VIEW THEIR ASSIGNED LEADS
CREATE POLICY "Telecallers view only assigned leads" ON public.leads
    FOR SELECT USING (
        organization_id = public.get_auth_org_id() AND
        (
            public.get_auth_role() = 'OWNER' OR
            (public.get_auth_role() = 'TELECALLER' AND assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid()))
        )
    );

-- TELECALLER CAN ONLY UPDATE STATUS/NOTES OF THEIR ASSIGNED LEADS
CREATE POLICY "Telecallers update only assigned leads" ON public.leads
    FOR UPDATE USING (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() = 'TELECALLER' AND
        assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- POLICIES: CALLS
CREATE POLICY "Owners view all org calls" ON public.calls
    FOR ALL USING (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER');

CREATE POLICY "Telecallers view their own calls" ON public.calls
    FOR SELECT USING (
        organization_id = public.get_auth_org_id() AND
        telecaller_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

CREATE POLICY "Telecallers insert their calls" ON public.calls
    FOR INSERT WITH CHECK (
        organization_id = public.get_auth_org_id() AND
        telecaller_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- POLICIES: CALL OUTCOMES
CREATE POLICY "Owners view all outcomes" ON public.call_outcomes
    FOR ALL USING (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER');

CREATE POLICY "Telecallers manage outcomes for their calls" ON public.call_outcomes
    FOR ALL USING (
        organization_id = public.get_auth_org_id() AND
        telecaller_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- POLICIES: FOLLOW UPS
CREATE POLICY "Owners view all followups" ON public.follow_ups
    FOR ALL USING (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER');

CREATE POLICY "Telecallers view and manage their followups" ON public.follow_ups
    FOR ALL USING (
        organization_id = public.get_auth_org_id() AND
        assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- POLICIES: NOTIFICATIONS
CREATE POLICY "Users view their own notifications" ON public.notifications
    FOR ALL USING (user_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- POLICIES: ACTIVITY LOGS
CREATE POLICY "Owners and Admins view activity logs" ON public.activity_logs
    FOR SELECT USING (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() IN ('OWNER', 'ADMIN')
    );

CREATE POLICY "Authenticated users can insert activity logs" ON public.activity_logs
    FOR INSERT WITH CHECK (organization_id = public.get_auth_org_id());

-- POLICIES: SECURITY EVENTS
CREATE POLICY "Owners and Admins view security events" ON public.security_events
    FOR SELECT USING (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() IN ('OWNER', 'ADMIN')
    );

CREATE POLICY "System can record security events" ON public.security_events
    FOR INSERT WITH CHECK (organization_id = public.get_auth_org_id());
