-- ============================================================================
-- ENCRIX Phase 23.3: Production-Safe Follow-Up Cron Concurrency & Atomic Claiming
-- Migration: 20261020000000_phase23_followup_reminder_concurrency.sql
-- ============================================================================
-- Description:
-- Adds an atomic, transaction-backed stored procedure for claiming and processing
-- follow-up reminders across tenant organizations.
--
-- Concurrency & Safety Model:
-- - Uses row-level locking (FOR UPDATE OF f SKIP LOCKED) to guarantee that
--   concurrent cron invocations process distinct follow-up records without duplication.
-- - Strictly verifies tenant isolation: linked lead must belong to the exact same
--   organization as the follow-up, and telecaller/owner notifications are scoped
--   exclusively to profiles within that organization.
-- - Operates inside a single ACID transaction. If an error occurs, the transaction
--   aborts and uncommitted timestamp updates roll back automatically.
--
-- Rollback Instructions:
-- DROP FUNCTION IF EXISTS public.process_follow_up_reminders_cron(TIMESTAMPTZ, UUID);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_follow_up_reminders_cron(
    p_reference_time TIMESTAMPTZ DEFAULT NOW(),
    p_target_org_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reminded_count INTEGER := 0;
    v_overdue_count INTEGER := 0;
    v_escalated_count INTEGER := 0;
    v_fup RECORD;
    v_lead RECORD;
    v_tc RECORD;
    v_owner RECORD;
    v_fifteen_mins_ahead TIMESTAMPTZ := p_reference_time + INTERVAL '15 minutes';
    v_thirty_mins_ago TIMESTAMPTZ := p_reference_time - INTERVAL '30 minutes';
BEGIN
    -- Iterate over candidate follow-ups using FOR UPDATE SKIP LOCKED
    -- to guarantee zero duplicate processing under concurrent cron workers
    FOR v_fup IN
        SELECT f.id, f.organization_id, f.lead_id, f.assigned_to, f.scheduled_at, f.status,
               f.reminded_at, f.overdue_notified_at, f.owner_alerted_at
        FROM public.follow_ups f
        WHERE f.status IN ('SCHEDULED', 'PENDING', 'DUE', 'OVERDUE')
          AND (p_target_org_id IS NULL OR f.organization_id = p_target_org_id)
          AND (
              (f.reminded_at IS NULL AND f.scheduled_at >= p_reference_time AND f.scheduled_at <= v_fifteen_mins_ahead)
              OR (f.overdue_notified_at IS NULL AND f.scheduled_at < p_reference_time)
              OR (f.owner_alerted_at IS NULL AND f.scheduled_at <= v_thirty_mins_ago)
          )
        ORDER BY f.scheduled_at ASC
        FOR UPDATE OF f SKIP LOCKED
    LOOP
        -- 1. Strict Tenant Verification: Linked lead must exist and match follow-up organization
        SELECT id, organization_id, lead_code, status
        INTO v_lead
        FROM public.leads
        WHERE id = v_fup.lead_id;

        IF v_lead.id IS NULL OR v_lead.organization_id != v_fup.organization_id THEN
            -- Record security audit event for cross-tenant or broken reference
            INSERT INTO public.security_events (
                organization_id, user_id, event_type, severity, description, metadata
            ) VALUES (
                v_fup.organization_id,
                v_fup.assigned_to,
                'CROSS_TENANT_FOLLOWUP_MISMATCH',
                'HIGH',
                'Follow-up links to missing lead or lead of a different organization. Processing skipped.',
                jsonb_build_object('follow_up_id', v_fup.id, 'lead_id', v_fup.lead_id)
            );
            CONTINUE;
        END IF;

        -- Exclude leads explicitly marked as DO_NOT_CONTACT or INVALID
        IF v_lead.status IN ('DO_NOT_CONTACT', 'INVALID') THEN
            CONTINUE;
        END IF;

        -- 2. Verify assigned telecaller profile exists and belongs to the same organization
        SELECT id, organization_id, full_name, role, status
        INTO v_tc
        FROM public.profiles
        WHERE id = v_fup.assigned_to;

        -- 3. Milestone 1: Upcoming Reminder (within 15 minutes before scheduled_at)
        IF v_fup.reminded_at IS NULL 
           AND v_fup.scheduled_at >= p_reference_time 
           AND v_fup.scheduled_at <= v_fifteen_mins_ahead THEN
            
            IF v_tc.id IS NOT NULL AND v_tc.organization_id = v_fup.organization_id AND v_tc.status = 'ACTIVE' THEN
                -- Atomically update reminded_at timestamp
                UPDATE public.follow_ups
                SET reminded_at = p_reference_time,
                    updated_at = NOW()
                WHERE id = v_fup.id;

                -- Insert Notification (Zero raw phone numbers or contact details)
                INSERT INTO public.notifications (
                    organization_id, user_id, type, title, message, link, read, created_at
                ) VALUES (
                    v_fup.organization_id,
                    v_fup.assigned_to,
                    'FOLLOW_UP_DUE',
                    'Follow-Up Due Soon',
                    'Upcoming callback for ' || COALESCE(v_lead.lead_code, 'lead') || ' is scheduled at ' || to_char(v_fup.scheduled_at AT TIME ZONE 'UTC', 'HH24:MI UTC') || '.',
                    '/telecaller/follow-ups',
                    false,
                    NOW()
                );

                -- Log Activity
                INSERT INTO public.activity_logs (
                    organization_id, user_id, action, entity_type, entity_id, metadata, created_at
                ) VALUES (
                    v_fup.organization_id,
                    v_fup.assigned_to,
                    'FOLLOWUP_REMINDER_SENT',
                    'follow_up',
                    v_fup.id,
                    jsonb_build_object(
                        'leadCode', v_lead.lead_code,
                        'scheduledAt', v_fup.scheduled_at,
                        'type', 'UPCOMING_REMINDER'
                    ),
                    NOW()
                );

                v_reminded_count := v_reminded_count + 1;
            END IF;
        END IF;

        -- 4. Milestone 2: Telecaller Overdue Notification (past scheduled_at)
        IF v_fup.overdue_notified_at IS NULL AND v_fup.scheduled_at < p_reference_time THEN
            IF v_tc.id IS NOT NULL AND v_tc.organization_id = v_fup.organization_id AND v_tc.status = 'ACTIVE' THEN
                UPDATE public.follow_ups
                SET overdue_notified_at = p_reference_time,
                    updated_at = NOW()
                WHERE id = v_fup.id;

                INSERT INTO public.notifications (
                    organization_id, user_id, type, title, message, link, read, created_at
                ) VALUES (
                    v_fup.organization_id,
                    v_fup.assigned_to,
                    'FOLLOW_UP_OVERDUE',
                    'Follow-Up Overdue',
                    'Scheduled callback for ' || COALESCE(v_lead.lead_code, 'lead') || ' was due at ' || to_char(v_fup.scheduled_at AT TIME ZONE 'UTC', 'HH24:MI UTC') || ' and is now overdue.',
                    '/telecaller/follow-ups',
                    false,
                    NOW()
                );

                INSERT INTO public.activity_logs (
                    organization_id, user_id, action, entity_type, entity_id, metadata, created_at
                ) VALUES (
                    v_fup.organization_id,
                    v_fup.assigned_to,
                    'FOLLOWUP_REMINDER_SENT',
                    'follow_up',
                    v_fup.id,
                    jsonb_build_object(
                        'leadCode', v_lead.lead_code,
                        'scheduledAt', v_fup.scheduled_at,
                        'type', 'OVERDUE_ALERT'
                    ),
                    NOW()
                );

                v_overdue_count := v_overdue_count + 1;
            END IF;
        END IF;

        -- 5. Milestone 3: Owner Overdue Escalation (>= 30 mins past scheduled_at)
        -- Separate and independent from telecaller overdue alert
        IF v_fup.owner_alerted_at IS NULL AND v_fup.scheduled_at <= v_thirty_mins_ago THEN
            UPDATE public.follow_ups
            SET owner_alerted_at = p_reference_time,
                updated_at = NOW()
            WHERE id = v_fup.id;

            -- Dispatch to active owners strictly within the same organization
            FOR v_owner IN
                SELECT id, organization_id
                FROM public.profiles
                WHERE organization_id = v_fup.organization_id
                  AND role = 'OWNER'
                  AND status = 'ACTIVE'
            LOOP
                INSERT INTO public.notifications (
                    organization_id, user_id, type, title, message, link, read, created_at
                ) VALUES (
                    v_fup.organization_id,
                    v_owner.id,
                    'FOLLOW_UP_OVERDUE',
                    'Overdue Lead Callback',
                    'Lead ' || COALESCE(v_lead.lead_code, 'lead') || ' is overdue for follow-up (assigned to agent). Review for escalation.',
                    '/owner/follow-ups',
                    false,
                    NOW()
                );
            END LOOP;

            INSERT INTO public.activity_logs (
                organization_id, user_id, action, entity_type, entity_id, metadata, created_at
            ) VALUES (
                v_fup.organization_id,
                v_fup.assigned_to,
                'FOLLOWUP_REMINDER_SENT',
                'follow_up',
                v_fup.id,
                jsonb_build_object(
                    'leadCode', v_lead.lead_code,
                    'scheduledAt', v_fup.scheduled_at,
                    'type', 'OWNER_ESCALATION'
                ),
                NOW()
            );

            v_escalated_count := v_escalated_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'reminded_count', v_reminded_count,
        'overdue_count', v_overdue_count,
        'escalated_count', v_escalated_count,
        'timestamp', p_reference_time
    );
END;
$$;

-- Restrict execution strictly to service_role to prevent unauthorized client triggers
REVOKE ALL ON FUNCTION public.process_follow_up_reminders_cron(TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_follow_up_reminders_cron(TIMESTAMPTZ, UUID) TO service_role;
