-- ============================================================================
-- ENCRIX Phase 21: Smart Follow-Up Engine & Overdue Escalation
-- ============================================================================
-- Extends follow_ups with full lifecycle statuses, timezone awareness,
-- rescheduling history, completion tracking, reminder/escalation stamps,
-- and high-performance concurrency indexes for cron reminder jobs.

-- 1. UPDATE FOLLOW_UPS STATUS CHECK CONSTRAINT
-- Adds 'SCHEDULED', 'DUE', 'RESCHEDULED', 'OVERDUE' while retaining 'PENDING', 'COMPLETED', 'MISSED', 'CANCELLED'
ALTER TABLE public.follow_ups
DROP CONSTRAINT IF EXISTS follow_ups_status_check;

ALTER TABLE public.follow_ups
ADD CONSTRAINT follow_ups_status_check
CHECK (status IN (
    'PENDING',
    'SCHEDULED',
    'DUE',
    'COMPLETED',
    'RESCHEDULED',
    'CANCELLED',
    'OVERDUE',
    'MISSED'
));

-- 2. EXTEND FOLLOW_UPS TABLE WITH LIFECYCLE & AUDIT COLUMNS
ALTER TABLE public.follow_ups
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS reason TEXT,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS outcome VARCHAR(100),
ADD COLUMN IF NOT EXISTS outcome_notes TEXT,
ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reschedule_reason TEXT,
ADD COLUMN IF NOT EXISTS previous_due_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS owner_alerted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS escalated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS escalation_reason TEXT;

-- 3. PERFORMANCE INDEXES FOR SCHEDULED QUERIES & CRON REMINDERS
CREATE INDEX IF NOT EXISTS idx_followups_org_status_scheduled
ON public.follow_ups(organization_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_followups_assigned_status
ON public.follow_ups(organization_id, assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_followups_lead_active
ON public.follow_ups(organization_id, lead_id, status)
WHERE status IN ('SCHEDULED', 'PENDING', 'DUE', 'OVERDUE');

-- Partial index for cron reminder queries (upcoming follow-ups not yet reminded)
CREATE INDEX IF NOT EXISTS idx_followups_pending_reminders
ON public.follow_ups(organization_id, scheduled_at)
WHERE reminded_at IS NULL AND status IN ('SCHEDULED', 'PENDING');

-- Partial index for telecaller overdue notification queries
CREATE INDEX IF NOT EXISTS idx_followups_pending_overdue_tc
ON public.follow_ups(organization_id, scheduled_at)
WHERE overdue_notified_at IS NULL AND status IN ('SCHEDULED', 'PENDING', 'DUE', 'OVERDUE');

-- Partial index for owner overdue escalation alerts
CREATE INDEX IF NOT EXISTS idx_followups_pending_overdue_owner
ON public.follow_ups(organization_id, scheduled_at)
WHERE owner_alerted_at IS NULL AND status IN ('SCHEDULED', 'PENDING', 'DUE', 'OVERDUE');

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- Re-affirm that telecallers can only view and update their own assigned follow-ups
-- while owners and admins view and manage follow-ups for their organization.
DROP POLICY IF EXISTS "Telecallers view and manage their followups" ON public.follow_ups;
CREATE POLICY "Telecallers view and manage their followups" ON public.follow_ups
    FOR ALL
    TO authenticated
    USING (
        organization_id = public.get_auth_org_id() AND
        assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
    WITH CHECK (
        organization_id = public.get_auth_org_id() AND
        assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Owners view all followups" ON public.follow_ups;
CREATE POLICY "Owners view all followups" ON public.follow_ups
    FOR ALL
    TO authenticated
    USING (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() IN ('OWNER', 'ADMIN')
    )
    WITH CHECK (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() IN ('OWNER', 'ADMIN')
    );
