BEGIN;

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
    ('90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p238-owner-a@example.test', '', NOW(), NOW(), NOW()),
    ('90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'p238-telecaller-a@example.test', '', NOW(), NOW(), NOW()),
    ('90000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p238-disabled-owner@example.test', '', NOW(), NOW(), NOW()),
    ('90000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p238-suspended-tc@example.test', '', NOW(), NOW(), NOW()),
    ('90000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p238-owner-b@example.test', '', NOW(), NOW(), NOW()),
    ('90000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p238-admin@example.test', '', NOW(), NOW(), NOW()),
    ('90000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p238-pending-tc@example.test', '', NOW(), NOW(), NOW());

INSERT INTO public.organizations (id, name, slug, owner_id)
VALUES
    ('91000000-0000-4000-8000-000000000001', 'Phase 23.8 Tenant A', 'phase-23-8-tenant-a', '92000000-0000-4000-8000-000000000001'),
    ('91000000-0000-4000-8000-000000000002', 'Phase 23.8 Tenant B', 'phase-23-8-tenant-b', '92000000-0000-4000-8000-000000000005');

INSERT INTO public.profiles (id, user_id, organization_id, full_name, role, status, phone_verified)
VALUES
    ('92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Active Owner A', 'OWNER', 'ACTIVE', TRUE),
    ('92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Active Telecaller A', 'TELECALLER', 'ACTIVE', TRUE),
    ('92000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'Disabled Owner A', 'OWNER', 'DISABLED', TRUE),
    ('92000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', 'Suspended Telecaller A', 'TELECALLER', 'SUSPENDED', TRUE),
    ('92000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000002', 'Active Owner B', 'OWNER', 'ACTIVE', TRUE),
    ('92000000-0000-4000-8000-000000000006', '90000000-0000-4000-8000-000000000006', NULL, 'Active Platform Admin', 'OWNER', 'ACTIVE', TRUE),
    ('92000000-0000-4000-8000-000000000007', '90000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000001', 'Pending Telecaller A', 'TELECALLER', 'PENDING', FALSE);

INSERT INTO public.leads (id, organization_id, lead_code, name, phone, email, assigned_to, notes)
VALUES
    ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'P238-A-TC', 'Mira 9876543210 Student', '+91 9876543210', 'mira@example.test', '92000000-0000-4000-8000-000000000002', 'Call +91 9876543210'),
    ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'P238-A-OWNER', 'Owner Lead', '+91 9000000001', 'owner@example.test', NULL, 'Owner note'),
    ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000002', 'P238-B-OWNER', 'Tenant B Lead', '+91 9000000002', 'tenantb@example.test', NULL, 'Tenant B note');

INSERT INTO public.calls (id, organization_id, lead_id, telecaller_id, status)
VALUES
    ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'COMPLETED'),
    ('94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000005', 'COMPLETED');

INSERT INTO public.call_recordings (id, organization_id, call_id, storage_path)
VALUES
    ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000001.mp3'),
    ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002/94000000-0000-4000-8000-000000000002.mp3');

INSERT INTO public.follow_ups (id, organization_id, lead_id, assigned_to, scheduled_at, status)
VALUES
    ('96000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', NOW() + INTERVAL '1 day', 'PENDING'),
    ('96000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000005', NOW() + INTERVAL '1 day', 'PENDING');

INSERT INTO public.notifications (id, organization_id, user_id, type, title, message)
VALUES
    ('97000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'TEST', 'Tenant A', 'Active telecaller notice'),
    ('97000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000005', 'TEST', 'Tenant B', 'Tenant B owner notice');

INSERT INTO public.security_events (id, organization_id, user_id, event_type, description)
VALUES
    ('98000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'P238_TEST', 'Tenant A test event'),
    ('98000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000005', 'P238_TEST', 'Tenant B test event');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', TRUE);
SELECT public.grant_platform_admin('92000000-0000-4000-8000-000000000006');
RESET ROLE;

-- Browser roles use authenticated server APIs for raw leads; neither role has
-- direct table access after the least-privilege migration.
DO $$
DECLARE
    v_role TEXT;
    v_privilege TEXT;
    v_column RECORD;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilege IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ] LOOP
            IF has_table_privilege(v_role, 'public.leads', v_privilege) THEN
                RAISE EXCEPTION '% unexpectedly has direct % on public.leads', v_role, v_privilege;
            END IF;
        END LOOP;
        FOR v_column IN
            SELECT a.attname
              FROM pg_catalog.pg_attribute AS a
             WHERE a.attrelid = 'public.leads'::pg_catalog.regclass
               AND a.attnum > 0
               AND NOT a.attisdropped
        LOOP
            FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
                IF has_column_privilege(v_role, 'public.leads', v_column.attname, v_privilege) THEN
                    RAISE EXCEPTION '% unexpectedly has column % on public.leads.%',
                        v_role, v_privilege, v_column.attname;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', TRUE);

DO $$
DECLARE
    affected INTEGER;
    blocked BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', TRUE);
    IF NOT public.is_active_authenticated_profile() OR public.get_auth_role() <> 'OWNER'
       OR public.get_auth_org_id() <> '91000000-0000-4000-8000-000000000001'::UUID THEN
        RAISE EXCEPTION 'Active owner helpers did not resolve the authenticated tenant.';
    END IF;
    IF (SELECT count(*) FROM public.profiles WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0
       OR (SELECT count(*) FROM public.calls WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0
       OR (SELECT count(*) FROM public.follow_ups WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0
       OR (SELECT count(*) FROM public.notifications WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0
       OR (SELECT count(*) FROM public.call_recordings WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0
       OR (SELECT count(*) FROM public.security_events WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0 THEN
        RAISE EXCEPTION 'Active owner read data from another organization.';
    END IF;

    -- Lead list/create/update/delete and cross-tenant behavior are exercised
    -- through authenticated API tests, not direct table privileges.

    blocked := FALSE;
    BEGIN
        UPDATE public.profiles SET role = 'ADMIN'
        WHERE id = '92000000-0000-4000-8000-000000000002';
        GET DIAGNOSTICS affected = ROW_COUNT;
        blocked := affected <> 1;
    EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN
        blocked := TRUE;
    END;
    IF NOT blocked OR (SELECT role FROM public.profiles WHERE id = '92000000-0000-4000-8000-000000000002') <> 'TELECALLER' THEN
        RAISE EXCEPTION 'Owner role escalation to global ADMIN was not blocked.';
    END IF;

    blocked := FALSE;
    BEGIN
        UPDATE public.profiles SET role = 'ADMIN'
        WHERE id = '92000000-0000-4000-8000-000000000005';
        GET DIAGNOSTICS affected = ROW_COUNT;
        blocked := affected <> 1;
    EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN
        blocked := TRUE;
    END;
    IF NOT blocked OR (SELECT role FROM public.profiles WHERE id = '92000000-0000-4000-8000-000000000005') <> 'OWNER' THEN
        RAISE EXCEPTION 'Owner role escalation of another owner to global ADMIN was not blocked.';
    END IF;

    UPDATE public.profiles SET full_name = 'Updated Active Telecaller'
    WHERE id = '92000000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Active owner could not update an organization profile.';
    END IF;

END;
$$;

DO $$
DECLARE
    affected INTEGER;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', TRUE);
    IF NOT public.is_active_authenticated_profile() OR public.get_auth_role() <> 'TELECALLER' THEN
        RAISE EXCEPTION 'Active telecaller was not authorized.';
    END IF;
    IF (SELECT count(*) FROM public.telecaller_leads_view) <> 1 THEN
        RAISE EXCEPTION 'Telecaller did not receive only the assigned lead through the safe view.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.telecaller_leads_view v
        WHERE v.id = '93000000-0000-4000-8000-000000000001'
          AND (
              to_jsonb(v) ? 'phone'
              OR to_jsonb(v)::TEXT ~ '9876543210'
              OR v.name ~ '[0-9]'
          )
    ) THEN
        RAISE EXCEPTION 'Telecaller safe view exposed phone digits or a phone column.';
    END IF;
    IF (SELECT count(*) FROM public.calls WHERE telecaller_id = '92000000-0000-4000-8000-000000000002') <> 1
       OR (SELECT count(*) FROM public.calls WHERE organization_id = '91000000-0000-4000-8000-000000000002') <> 0
       OR (SELECT count(*) FROM public.follow_ups WHERE assigned_to = '92000000-0000-4000-8000-000000000002') <> 1
       OR (SELECT count(*) FROM public.notifications WHERE user_id = '92000000-0000-4000-8000-000000000002') <> 1
       OR (SELECT count(*) FROM public.call_recordings WHERE call_id = '94000000-0000-4000-8000-000000000001') <> 1 THEN
        RAISE EXCEPTION 'Active telecaller lost permitted assigned records or crossed tenant boundaries.';
    END IF;
    IF public.get_telecaller_student_detail('93000000-0000-4000-8000-000000000001')::TEXT
       ~ '9876543210|9000000001' THEN
        RAISE EXCEPTION 'Telecaller detail RPC exposed student phone digits.';
    END IF;
    IF public.can_access_call_recording_path(
        '91000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000001.mp3'
    ) IS DISTINCT FROM TRUE
       OR public.can_access_call_recording_path(
        '91000000-0000-4000-8000-000000000002/94000000-0000-4000-8000-000000000002.mp3'
    ) IS DISTINCT FROM FALSE
       OR public.can_access_call_recording_path('../94000000-0000-4000-8000-000000000001.mp3') IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Recording path authorization did not preserve active assignment and tenant restrictions.';
    END IF;

    -- Assigned/unassigned telecaller writes are tested through the narrowly
    -- scoped RPC in phase24_3_telecaller_lead_access.test.sql.

    INSERT INTO public.calls (organization_id, lead_id, telecaller_id, status)
    VALUES ('91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'COMPLETED');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Active telecaller could not insert a permitted call.';
    END IF;

    UPDATE public.follow_ups SET notes = 'updated by assigned telecaller'
    WHERE id = '96000000-0000-4000-8000-000000000001';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Active telecaller could not update an assigned follow-up.';
    END IF;
END;
$$;

DO $$
DECLARE
    affected INTEGER;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000006', TRUE);
    IF NOT public.is_active_authenticated_profile() OR public.get_auth_role() <> 'ADMIN' THEN
        RAISE EXCEPTION 'Active platform admin was not authorized.';
    END IF;
    IF (SELECT count(*) FROM public.profiles WHERE id = '92000000-0000-4000-8000-000000000005') <> 1 THEN
        RAISE EXCEPTION 'Active platform admin profile lookup failed.';
    END IF;
    -- Admin cross-organization lead behavior belongs in authenticated API tests.
END;
$$;

DO $$
DECLARE
    affected INTEGER;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', TRUE);
    IF public.is_active_authenticated_profile()
       OR public.get_auth_role() IS NOT NULL
       OR public.get_auth_org_id() IS NOT NULL
       OR (public.get_auth_profile()).id IS NOT NULL THEN
        RAISE EXCEPTION 'Disabled profile was accepted by an auth helper.';
    END IF;
    BEGIN
        PERFORM public.get_telecaller_student_detail('93000000-0000-4000-8000-000000000001');
        RAISE EXCEPTION 'Disabled owner accessed the telecaller detail RPC.';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'Disabled owner accessed the telecaller detail RPC.' THEN
            RAISE;
        END IF;
    END;
    IF (SELECT count(*) FROM public.profiles) <> 0
       OR (SELECT count(*) FROM public.organizations) <> 0
       OR (SELECT count(*) FROM public.calls) <> 0
       OR (SELECT count(*) FROM public.follow_ups) <> 0
       OR (SELECT count(*) FROM public.notifications) <> 0
       OR (SELECT count(*) FROM public.call_recordings) <> 0
       OR (SELECT count(*) FROM public.security_events) <> 0
       OR (SELECT count(*) FROM public.activity_logs) <> 0 THEN
        RAISE EXCEPTION 'Disabled owner read tenant data.';
    END IF;
    UPDATE public.profiles SET status = 'ACTIVE'
    WHERE user_id = auth.uid();
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
        RAISE EXCEPTION 'Disabled owner reactivated their own profile.';
    END IF;
END;
$$;

DO $$
DECLARE
    affected INTEGER;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000004', TRUE);
    IF public.is_active_authenticated_profile()
       OR public.get_auth_role() IS NOT NULL
       OR (public.get_auth_profile()).id IS NOT NULL THEN
        RAISE EXCEPTION 'Suspended telecaller was accepted by an auth helper.';
    END IF;
    BEGIN
        PERFORM public.get_telecaller_student_detail('93000000-0000-4000-8000-000000000001');
        RAISE EXCEPTION 'Suspended telecaller accessed the detail RPC.';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'Suspended telecaller accessed the detail RPC.' THEN
            RAISE;
        END IF;
    END;
    IF (SELECT count(*) FROM public.telecaller_leads_view) <> 0
       OR (SELECT count(*) FROM public.calls) <> 0
       OR (SELECT count(*) FROM public.follow_ups) <> 0
       OR (SELECT count(*) FROM public.notifications) <> 0
       OR (SELECT count(*) FROM public.call_recordings) <> 0 THEN
        RAISE EXCEPTION 'Suspended telecaller read tenant data.';
    END IF;
    DELETE FROM public.follow_ups;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
        RAISE EXCEPTION 'Suspended telecaller deleted follow-ups.';
    END IF;
    BEGIN
        INSERT INTO public.calls (organization_id, lead_id, telecaller_id, status)
        VALUES ('91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000004', 'COMPLETED');
        RAISE EXCEPTION 'Suspended telecaller inserted a call.';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$$;

DO $$
DECLARE
    affected INTEGER;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', TRUE);
    IF public.is_active_authenticated_profile()
       OR public.get_auth_role() IS NOT NULL
       OR public.get_auth_org_id() IS NOT NULL
       OR (public.get_auth_profile()).id IS NOT NULL THEN
        RAISE EXCEPTION 'Pending profile was accepted by an auth helper.';
    END IF;
    IF (SELECT count(*) FROM public.telecaller_leads_view) <> 0
       OR (SELECT count(*) FROM public.calls) <> 0
       OR (SELECT count(*) FROM public.follow_ups) <> 0
       OR (SELECT count(*) FROM public.notifications) <> 0
       OR (SELECT count(*) FROM public.call_recordings) <> 0 THEN
        RAISE EXCEPTION 'Pending telecaller read tenant data.';
    END IF;
    BEGIN
        INSERT INTO public.calls (organization_id, lead_id, telecaller_id, status)
        VALUES ('91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000007', 'COMPLETED');
        RAISE EXCEPTION 'Pending telecaller inserted a call.';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$$;

RESET ROLE;
ROLLBACK;
