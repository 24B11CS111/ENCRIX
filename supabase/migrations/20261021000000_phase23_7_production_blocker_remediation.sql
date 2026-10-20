-- ENCRIX Phase 23.7: Production blocker remediation

-- Only the explicit service-role platform flow may assign the global ADMIN role.
CREATE OR REPLACE FUNCTION public.protect_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    caller_role VARCHAR;
    platform_admin_grant BOOLEAN := COALESCE(
        auth.role() = 'service_role'
        AND current_setting('encrix.platform_admin_grant', true) = 'on',
        false
    );
BEGIN
    IF auth.uid() IS NOT NULL THEN
        SELECT role INTO caller_role
        FROM public.profiles
        WHERE user_id = auth.uid()
        LIMIT 1;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.role = 'ADMIN' AND NOT platform_admin_grant THEN
            RAISE EXCEPTION 'Privilege Violation: Only the platform administration flow can grant global administrator access.';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.role = 'ADMIN'
           AND OLD.role IS DISTINCT FROM NEW.role
           AND NOT platform_admin_grant THEN
            RAISE EXCEPTION 'Privilege Violation: Only the platform administration flow can grant global administrator access.';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
           AND COALESCE(caller_role, '') <> 'ADMIN'
           AND auth.role() IS DISTINCT FROM 'service_role' THEN
            RAISE EXCEPTION 'Privilege Violation: Changing organization_id is restricted to platform administrators.';
        END IF;

        IF NEW.role IS DISTINCT FROM OLD.role THEN
            IF OLD.user_id = auth.uid() THEN
                RAISE EXCEPTION 'Privilege Violation: Self-elevation of user role is strictly prohibited.';
            END IF;
            IF COALESCE(caller_role, '') NOT IN ('ADMIN', 'OWNER')
               AND auth.role() IS DISTINCT FROM 'service_role' THEN
                RAISE EXCEPTION 'Privilege Violation: Only organization owners and platform administrators can modify user roles.';
            END IF;
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF OLD.user_id = auth.uid()
               AND OLD.status IS DISTINCT FROM 'ACTIVE'
               AND NEW.status = 'ACTIVE' THEN
                RAISE EXCEPTION 'Privilege Violation: Inactive users cannot reactivate their own accounts.';
            END IF;
            IF COALESCE(caller_role, '') NOT IN ('ADMIN', 'OWNER')
               AND auth.role() IS DISTINCT FROM 'service_role' THEN
                RAISE EXCEPTION 'Privilege Violation: Only organization owners and platform administrators can modify account statuses.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_protect_profile_privilege_escalation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privilege_escalation();

REVOKE EXECUTE ON FUNCTION public.protect_profile_privilege_escalation()
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_platform_admin(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Only the platform administration service can grant global administrator access.';
    END IF;

    PERFORM set_config('encrix.platform_admin_grant', 'on', true);
    UPDATE public.profiles
    SET role = 'ADMIN', updated_at = NOW()
    WHERE id = p_profile_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found.';
    END IF;
    PERFORM set_config('encrix.platform_admin_grant', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_platform_admin(UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_platform_admin(UUID) TO service_role;

-- Prevent direct raw-lead SELECT by telecallers, even if another permissive
-- SELECT policy is added later.
DROP POLICY IF EXISTS "Telecallers cannot select raw leads" ON public.leads;
CREATE POLICY "Telecallers cannot select raw leads" ON public.leads
    AS RESTRICTIVE
    FOR SELECT
    TO authenticated
    USING (public.get_auth_role() <> 'TELECALLER');

-- The owner-owned view must validate the current active profile itself because
-- its owner bypasses the table's row-level security policies.
DROP VIEW IF EXISTS public.telecaller_leads_view;
CREATE VIEW public.telecaller_leads_view
WITH (security_barrier = true)
AS
SELECT
    l.id,
    l.organization_id,
    l.lead_code,
    CASE
        WHEN POSITION(' ' IN BTRIM(n.clean_name)) = 0
            THEN COALESCE(NULLIF(BTRIM(n.clean_name), ''), 'Student')
        ELSE SPLIT_PART(BTRIM(n.clean_name), ' ', 1) || ' ' ||
             LEFT(SPLIT_PART(BTRIM(n.clean_name), ' ', 2), 1) || '.'
    END AS name,
    '***@***.***' AS email,
    REGEXP_REPLACE(l.source, '[0-9]', '', 'g') AS source,
    l.status,
    l.priority,
    l.assigned_to,
    REGEXP_REPLACE(l.notes, '[0-9]', '', 'g') AS notes,
    REGEXP_REPLACE(l.father_name, '[0-9]', '', 'g') AS father_name,
    REGEXP_REPLACE(l.mother_name, '[0-9]', '', 'g') AS mother_name,
    CASE WHEN l.neet_score::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.neet_score END AS neet_score,
    CASE WHEN l.neet_rank::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.neet_rank END AS neet_rank,
    CASE WHEN l.neet_year::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.neet_year END AS neet_year,
    CASE WHEN l.neet_attempts::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.neet_attempts END AS neet_attempts,
    CASE WHEN l.eamcet_score::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.eamcet_score END AS eamcet_score,
    CASE WHEN l.eamcet_rank::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.eamcet_rank END AS eamcet_rank,
    CASE WHEN l.eamcet_year::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.eamcet_year END AS eamcet_year,
    CASE WHEN l.eamcet_attempts::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.eamcet_attempts END AS eamcet_attempts,
    CASE WHEN l.ipe_marks::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.ipe_marks END AS ipe_marks,
    CASE WHEN l.ipe_percentage::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.ipe_percentage END AS ipe_percentage,
    CASE WHEN l.ipe_year::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.ipe_year END AS ipe_year,
    CASE WHEN l.ipe_attempts::TEXT ~ '[0-9]{5,}' THEN NULL ELSE l.ipe_attempts END AS ipe_attempts,
    REGEXP_REPLACE(l.category, '[0-9]', '', 'g') AS category,
    REGEXP_REPLACE(l.gender, '[0-9]', '', 'g') AS gender,
    REGEXP_REPLACE(l.city, '[0-9]', '', 'g') AS city,
    REGEXP_REPLACE(l.state, '[0-9]', '', 'g') AS state,
    REGEXP_REPLACE(l.school_or_college, '[0-9]', '', 'g') AS school_or_college,
    REGEXP_REPLACE(l.course_interest, '[0-9]', '', 'g') AS course_interest,
    l.last_contacted_at,
    l.calls_count,
    l.created_at,
    l.updated_at
FROM public.leads l
CROSS JOIN LATERAL (
    SELECT BTRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(l.name, ''), '[0-9]', '', 'g'),
                '[-_./,()+]+',
                ' ',
                'g'
            ),
            '[[:space:]]+',
            ' ',
            'g'
        )
    ) AS clean_name
) n
JOIN public.profiles p
  ON p.id = l.assigned_to
 AND p.organization_id = l.organization_id
WHERE p.user_id = auth.uid()
  AND p.role = 'TELECALLER'
  AND p.status = 'ACTIVE';

REVOKE ALL ON public.telecaller_leads_view FROM anon, PUBLIC;
GRANT SELECT ON public.telecaller_leads_view TO authenticated;

-- Keep the existing RPC's assignment, organization, and active-profile checks,
-- while ensuring it is no longer directly exposed and stripping digits from
-- telecaller-visible free text and phone-sized numeric values.
ALTER FUNCTION public.get_telecaller_student_detail(UUID)
    RENAME TO get_telecaller_student_detail_legacy;
REVOKE ALL ON FUNCTION public.get_telecaller_student_detail_legacy(UUID)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_telecaller_student_detail(target_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    caller_profile public.profiles;
    result JSONB;
    item RECORD;
BEGIN
    SELECT * INTO caller_profile
    FROM public.profiles
    WHERE user_id = auth.uid()
    LIMIT 1;

    IF caller_profile.id IS NULL OR caller_profile.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated or inactive profile.';
    END IF;

    result := public.get_telecaller_student_detail_legacy(target_lead_id);
    IF caller_profile.role <> 'TELECALLER' THEN
        RETURN result;
    END IF;

    FOR item IN SELECT key, value FROM jsonb_each(result)
    LOOP
        IF jsonb_typeof(item.value) = 'string'
           AND item.key NOT IN ('id', 'organization_id', 'lead_code', 'email',
                                'status', 'priority', 'gender', 'category',
                                'created_at', 'updated_at', 'last_contacted_at') THEN
            result := jsonb_set(
                result,
                ARRAY[item.key],
                to_jsonb(REGEXP_REPLACE(item.value #>> '{}', '[0-9]', '', 'g'))
            );
        ELSIF jsonb_typeof(item.value) = 'number'
           AND item.value::TEXT ~ '[0-9]{5,}' THEN
            result := jsonb_set(result, ARRAY[item.key], 'null'::JSONB);
        END IF;
    END LOOP;
    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_telecaller_student_detail(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telecaller_student_detail(UUID)
TO authenticated;

-- Preserve the atomic row claim. An escalation is marked handled only after
-- at least one active same-tenant owner has received a recorded notification.
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
    v_owner_count INTEGER;
    v_fifteen_mins_ahead TIMESTAMPTZ := p_reference_time + INTERVAL '15 minutes';
    v_thirty_mins_ago TIMESTAMPTZ := p_reference_time - INTERVAL '30 minutes';
BEGIN
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
        SELECT id, organization_id, lead_code, status
        INTO v_lead
        FROM public.leads
        WHERE id = v_fup.lead_id;

        IF v_lead.id IS NULL OR v_lead.organization_id <> v_fup.organization_id THEN
            INSERT INTO public.security_events (
                organization_id, user_id, event_type, severity, description, metadata
            ) VALUES (
                v_fup.organization_id, v_fup.assigned_to,
                'CROSS_TENANT_FOLLOWUP_MISMATCH', 'HIGH',
                'Follow-up links to missing lead or lead of a different organization. Processing skipped.',
                jsonb_build_object('follow_up_id', v_fup.id, 'lead_id', v_fup.lead_id)
            );
            CONTINUE;
        END IF;
        IF v_lead.status IN ('DO_NOT_CONTACT', 'INVALID') THEN
            CONTINUE;
        END IF;

        SELECT id, organization_id, full_name, role, status
        INTO v_tc
        FROM public.profiles
        WHERE id = v_fup.assigned_to;

        IF v_fup.reminded_at IS NULL
           AND v_fup.scheduled_at >= p_reference_time
           AND v_fup.scheduled_at <= v_fifteen_mins_ahead
           AND v_tc.id IS NOT NULL
           AND v_tc.organization_id = v_fup.organization_id
           AND v_tc.status = 'ACTIVE' THEN
            UPDATE public.follow_ups
            SET reminded_at = p_reference_time, updated_at = NOW()
            WHERE id = v_fup.id;
            INSERT INTO public.notifications (
                organization_id, user_id, type, title, message, link, read, created_at
            ) VALUES (
                v_fup.organization_id, v_fup.assigned_to, 'FOLLOW_UP_DUE',
                'Follow-Up Due Soon',
                'Upcoming callback for ' || COALESCE(v_lead.lead_code, 'lead') ||
                    ' is scheduled at ' || to_char(v_fup.scheduled_at AT TIME ZONE 'UTC', 'HH24:MI UTC') || '.',
                '/telecaller/follow-ups', false, NOW()
            );
            INSERT INTO public.activity_logs (
                organization_id, user_id, action, entity_type, entity_id, metadata, created_at
            ) VALUES (
                v_fup.organization_id, v_fup.assigned_to, 'FOLLOWUP_REMINDER_SENT',
                'follow_up', v_fup.id,
                jsonb_build_object('leadCode', v_lead.lead_code, 'scheduledAt', v_fup.scheduled_at, 'type', 'UPCOMING_REMINDER'),
                NOW()
            );
            v_reminded_count := v_reminded_count + 1;
        END IF;

        IF v_fup.overdue_notified_at IS NULL
           AND v_fup.scheduled_at < p_reference_time
           AND v_tc.id IS NOT NULL
           AND v_tc.organization_id = v_fup.organization_id
           AND v_tc.status = 'ACTIVE' THEN
            UPDATE public.follow_ups
            SET overdue_notified_at = p_reference_time, updated_at = NOW()
            WHERE id = v_fup.id;
            INSERT INTO public.notifications (
                organization_id, user_id, type, title, message, link, read, created_at
            ) VALUES (
                v_fup.organization_id, v_fup.assigned_to, 'FOLLOW_UP_OVERDUE',
                'Follow-Up Overdue',
                'Scheduled callback for ' || COALESCE(v_lead.lead_code, 'lead') ||
                    ' was due at ' || to_char(v_fup.scheduled_at AT TIME ZONE 'UTC', 'HH24:MI UTC') || ' and is now overdue.',
                '/telecaller/follow-ups', false, NOW()
            );
            INSERT INTO public.activity_logs (
                organization_id, user_id, action, entity_type, entity_id, metadata, created_at
            ) VALUES (
                v_fup.organization_id, v_fup.assigned_to, 'FOLLOWUP_REMINDER_SENT',
                'follow_up', v_fup.id,
                jsonb_build_object('leadCode', v_lead.lead_code, 'scheduledAt', v_fup.scheduled_at, 'type', 'OVERDUE_ALERT'),
                NOW()
            );
            v_overdue_count := v_overdue_count + 1;
        END IF;

        IF v_fup.owner_alerted_at IS NULL
           AND v_fup.scheduled_at <= v_thirty_mins_ago THEN
            v_owner_count := 0;
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
                    v_fup.organization_id, v_owner.id, 'FOLLOW_UP_OVERDUE',
                    'Overdue Lead Callback',
                    'Lead ' || COALESCE(v_lead.lead_code, 'lead') ||
                        ' is overdue for follow-up (assigned to agent). Review for escalation.',
                    '/owner/follow-ups', false, NOW()
                );
                v_owner_count := v_owner_count + 1;
            END LOOP;

            IF v_owner_count > 0 THEN
                UPDATE public.follow_ups
                SET owner_alerted_at = p_reference_time, updated_at = NOW()
                WHERE id = v_fup.id;
                INSERT INTO public.activity_logs (
                    organization_id, user_id, action, entity_type, entity_id, metadata, created_at
                ) VALUES (
                    v_fup.organization_id, v_fup.assigned_to, 'FOLLOWUP_REMINDER_SENT',
                    'follow_up', v_fup.id,
                    jsonb_build_object('leadCode', v_lead.lead_code, 'scheduledAt', v_fup.scheduled_at, 'type', 'OWNER_ESCALATION'),
                    NOW()
                );
                v_escalated_count := v_escalated_count + 1;
            END IF;
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

REVOKE ALL ON FUNCTION public.process_follow_up_reminders_cron(TIMESTAMPTZ, UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_follow_up_reminders_cron(TIMESTAMPTZ, UUID)
TO service_role;
