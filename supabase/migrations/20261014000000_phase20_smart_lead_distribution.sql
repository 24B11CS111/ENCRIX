-- ============================================================================
-- ENCRIX Phase 20: Smart Lead Distribution & Workload Balancing
-- ============================================================================
-- Adds organization-level distribution configs, persistent round-robin cursors,
-- workload balancing indexes, unassigned queue reasons, and reassignment audit trails.

-- 1. DISTRIBUTION CONFIGURATIONS TABLE
CREATE TABLE IF NOT EXISTS public.distribution_configs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
    mode VARCHAR(50) NOT NULL DEFAULT 'MANUAL' CHECK (mode IN ('MANUAL', 'ROUND_ROBIN', 'WORKLOAD_BALANCED')),
    enabled_for_import BOOLEAN NOT NULL DEFAULT FALSE,
    max_workload INTEGER DEFAULT NULL CHECK (max_workload IS NULL OR max_workload > 0),
    eligible_telecaller_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    round_robin_index INTEGER NOT NULL DEFAULT 0 CHECK (round_robin_index >= 0),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. EXTEND LEADS TABLE WITH DISTRIBUTION & UNASSIGNED AUDIT COLUMNS
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS unassigned_reason VARCHAR(100),
ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reassign_reason TEXT;

-- 3. EXTEND LEAD ASSIGNMENTS TABLE WITH REASSIGNMENT AUDIT COLUMNS
ALTER TABLE public.lead_assignments
ADD COLUMN IF NOT EXISTS reassign_reason TEXT,
ADD COLUMN IF NOT EXISTS previous_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS mode VARCHAR(50) DEFAULT 'MANUAL';

-- 4. PERFORMANCE & CONCURRENCY INDEXES
CREATE INDEX IF NOT EXISTS idx_distribution_configs_org
ON public.distribution_configs(organization_id);

CREATE INDEX IF NOT EXISTS idx_leads_open_workload
ON public.leads(organization_id, assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_leads_unassigned_queue
ON public.leads(organization_id, created_at DESC)
WHERE assigned_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_active
ON public.lead_assignments(lead_id, user_id)
WHERE unassigned_at IS NULL;

-- 5. ROW LEVEL SECURITY (RLS) FOR DISTRIBUTION CONFIGURATIONS
ALTER TABLE public.distribution_configs ENABLE ROW LEVEL SECURITY;

-- Owner & Admin: View configuration for their organization
CREATE POLICY "Owners and Admins can view distribution config"
ON public.distribution_configs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
        AND p.organization_id = distribution_configs.organization_id
        AND p.role IN ('OWNER', 'ADMIN')
        AND p.status = 'ACTIVE'
    )
);

-- Owner & Admin: Insert configuration for their organization
CREATE POLICY "Owners and Admins can insert distribution config"
ON public.distribution_configs
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
        AND p.organization_id = distribution_configs.organization_id
        AND p.role IN ('OWNER', 'ADMIN')
        AND p.status = 'ACTIVE'
    )
);

-- Owner & Admin: Update configuration for their organization
CREATE POLICY "Owners and Admins can update distribution config"
ON public.distribution_configs
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
        AND p.organization_id = distribution_configs.organization_id
        AND p.role IN ('OWNER', 'ADMIN')
        AND p.status = 'ACTIVE'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
        AND p.organization_id = distribution_configs.organization_id
        AND p.role IN ('OWNER', 'ADMIN')
        AND p.status = 'ACTIVE'
    )
);

-- Telecallers: Explicitly no access to distribution config table (zero leakage)
-- No policy added for TELECALLER role = default deny by RLS.

-- 6. SEED DEFAULT CONFIGS FOR EXISTING ACTIVE ORGANIZATIONS
INSERT INTO public.distribution_configs (organization_id, mode, enabled_for_import, max_workload, eligible_telecaller_ids)
SELECT id, 'MANUAL', FALSE, NULL, '[]'::jsonb
FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;
