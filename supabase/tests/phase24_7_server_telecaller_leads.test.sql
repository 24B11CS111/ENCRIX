-- Local PostgreSQL regression tests for Phase 24.7: Secure Server-Side Telecaller Lead API.
-- Run against a local PostgreSQL database or Supabase CLI environment.
-- All fixture mutations are strictly contained within a transaction and rolled back.
\set ON_ERROR_STOP on
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. FIXTURE SETUP
-- ----------------------------------------------------------------------------
INSERT INTO public.organizations(id, name, slug, owner_id) VALUES
('a7000000-0000-4000-8000-000000000001', 'Phase 24.7 Org A', 'phase247-a', 'a7000000-0000-4000-8000-000000000013'),
('a7000000-0000-4000-8000-000000000002', 'Phase 24.7 Org B', 'phase247-b', 'a7000000-0000-4000-8000-000000000023');

INSERT INTO public.profiles(id, user_id, organization_id, full_name, role, status, phone, phone_verified) VALUES
('a7000000-0000-4000-8000-000000000101', 'a7000000-0000-4000-8000-000000000011', 'a7000000-0000-4000-8000-000000000001', 'Active Caller A1', 'TELECALLER', 'ACTIVE', NULL, FALSE),
('a7000000-0000-4000-8000-000000000102', 'a7000000-0000-4000-8000-000000000012', 'a7000000-0000-4000-8000-000000000001', 'Disabled Caller A2', 'TELECALLER', 'DISABLED', NULL, FALSE),
('a7000000-0000-4000-8000-000000000103', 'a7000000-0000-4000-8000-000000000013', 'a7000000-0000-4000-8000-000000000001', 'Owner A', 'OWNER', 'ACTIVE', NULL, FALSE),
('a7000000-0000-4000-8000-000000000104', 'a7000000-0000-4000-8000-000000000014', 'a7000000-0000-4000-8000-000000000002', 'Caller B1', 'TELECALLER', 'ACTIVE', NULL, FALSE),
('a7000000-0000-4000-8000-000000000105', 'a7000000-0000-4000-8000-000000000015', 'a7000000-0000-4000-8000-000000000001', 'Active Caller A3', 'TELECALLER', 'ACTIVE', NULL, FALSE);

INSERT INTO public.leads(id, organization_id, lead_code, name, phone, email, source, status, priority, assigned_to, notes) VALUES
('a7000000-0000-4000-8000-000000000201', 'a7000000-0000-4000-8000-000000000001', 'P247-A1', 'Vikramaditya Sharma 9876543210', '+919876543210', 'vikram.sharma@example.invalid', 'Referral 9876543210', 'NEW', 'HIGH', 'a7000000-0000-4000-8000-000000000101', 'Initial inquiry note 9876543210'),
('a7000000-0000-4000-8000-000000000202', 'a7000000-0000-4000-8000-000000000001', 'P247-A2', 'Unassigned Lead', '+919876543211', 'unassigned@example.invalid', 'Website', 'NEW', 'LOW', NULL, 'Pending distribution'),
('a7000000-0000-4000-8000-000000000203', 'a7000000-0000-4000-8000-000000000002', 'P247-B1', 'Tenant B Lead', '+919876543212', 'tenantb@example.invalid', 'Adwords', 'NEW', 'MEDIUM', 'a7000000-0000-4000-8000-000000000104', 'Private org B notes'),
('a7000000-0000-4000-8000-000000000204', 'a7000000-0000-4000-8000-000000000001', 'P247-A3', 'Colleague Lead', '+919876543213', 'colleague@example.invalid', 'Campaign', 'NEW', 'MEDIUM', 'a7000000-0000-4000-8000-000000000105', 'Assigned to caller A3'),
('a7000000-0000-4000-8000-000000000205', 'a7000000-0000-4000-8000-000000000001', 'P247-A4', 'Disabled Caller Lead', '+919876543214', 'disabled@example.invalid', 'Events', 'NEW', 'LOW', 'a7000000-0000-4000-8000-000000000102', 'Assigned to disabled caller');

-- ----------------------------------------------------------------------------
-- 2. VERIFY SECURITY DEFINER, SEARCH_PATH, AND PRIVILEGES
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_read_oid REGPROCEDURE := 'public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)'::regprocedure;
    v_update_oid REGPROCEDURE := 'public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
BEGIN
    -- Read function check
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_read_oid) THEN
        RAISE EXCEPTION 'server_get_assigned_telecaller_leads is not SECURITY DEFINER';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
         WHERE oid = v_read_oid
           AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    ) THEN
        RAISE EXCEPTION 'server_get_assigned_telecaller_leads does not pin safe search_path';
    END IF;
    IF has_function_privilege('anon', v_read_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_read_oid, 'EXECUTE')
       OR EXISTS (
            SELECT 1 FROM pg_proc AS proc
            CROSS JOIN LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS acl
             WHERE proc.oid = v_read_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'server_get_assigned_telecaller_leads exposes execute to browser roles or PUBLIC';
    END IF;
    IF NOT has_function_privilege('service_role', v_read_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'server_get_assigned_telecaller_leads is not executable by service_role';
    END IF;

    -- Update function check
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_update_oid) THEN
        RAISE EXCEPTION 'server_update_assigned_telecaller_lead is not SECURITY DEFINER';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
         WHERE oid = v_update_oid
           AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    ) THEN
        RAISE EXCEPTION 'server_update_assigned_telecaller_lead does not pin safe search_path';
    END IF;
    IF has_function_privilege('anon', v_update_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_update_oid, 'EXECUTE')
       OR EXISTS (
            SELECT 1 FROM pg_proc AS proc
            CROSS JOIN LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS acl
             WHERE proc.oid = v_update_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'server_update_assigned_telecaller_lead exposes execute to browser roles or PUBLIC';
    END IF;
    IF NOT has_function_privilege('service_role', v_update_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'server_update_assigned_telecaller_lead is not executable by service_role';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. PROVE BROWSER ROLES CANNOT EXECUTE PRIVILEGED SERVER FUNCTIONS
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        PERFORM public.server_get_assigned_telecaller_leads(
            'a7000000-0000-4000-8000-000000000011',
            'a7000000-0000-4000-8000-000000000101',
            'a7000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'anon unexpectedly executed server_get_assigned_telecaller_leads';
    EXCEPTION WHEN insufficient_privilege THEN
        -- Expected
    END;

    BEGIN
        PERFORM public.server_update_assigned_telecaller_lead(
            'a7000000-0000-4000-8000-000000000011',
            'a7000000-0000-4000-8000-000000000101',
            'a7000000-0000-4000-8000-000000000001',
            'a7000000-0000-4000-8000-000000000201',
            'CONTACTED',
            'Attempt'
        );
        RAISE EXCEPTION 'anon unexpectedly executed server_update_assigned_telecaller_lead';
    EXCEPTION WHEN insufficient_privilege THEN
        -- Expected
    END;
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000011';
SET LOCAL request.jwt.claims = '{"sub":"a7000000-0000-4000-8000-000000000011","role":"authenticated"}';
DO $$
BEGIN
    BEGIN
        PERFORM public.server_get_assigned_telecaller_leads(
            'a7000000-0000-4000-8000-000000000011',
            'a7000000-0000-4000-8000-000000000101',
            'a7000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'authenticated unexpectedly executed server_get_assigned_telecaller_leads';
    EXCEPTION WHEN insufficient_privilege THEN
        -- Expected
    END;

    BEGIN
        PERFORM public.server_update_assigned_telecaller_lead(
            'a7000000-0000-4000-8000-000000000011',
            'a7000000-0000-4000-8000-000000000101',
            'a7000000-0000-4000-8000-000000000001',
            'a7000000-0000-4000-8000-000000000201',
            'CONTACTED',
            'Attempt'
        );
        RAISE EXCEPTION 'authenticated unexpectedly executed server_update_assigned_telecaller_lead';
    EXCEPTION WHEN insufficient_privilege THEN
        -- Expected
    END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. FUNCTIONAL VALIDATION AS service_role (SERVER API EXECUTION)
-- ----------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- Test 4A: server_get_assigned_telecaller_leads returns ONLY assigned leads for active telecaller
DO $$
DECLARE
    v_count INTEGER;
    v_row RECORD;
BEGIN
    SELECT count(*) INTO v_count
      FROM public.server_get_assigned_telecaller_leads(
          'a7000000-0000-4000-8000-000000000011',
          'a7000000-0000-4000-8000-000000000101',
          'a7000000-0000-4000-8000-000000000001'
      );
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Expected exactly 1 assigned lead for Caller A1, got %', v_count;
    END IF;

    SELECT * INTO v_row
      FROM public.server_get_assigned_telecaller_leads(
          'a7000000-0000-4000-8000-000000000011',
          'a7000000-0000-4000-8000-000000000101',
          'a7000000-0000-4000-8000-000000000001'
      );

    IF v_row.id <> 'a7000000-0000-4000-8000-000000000201' THEN
        RAISE EXCEPTION 'Unexpected lead ID returned: %', v_row.id;
    END IF;

    -- Verify sanitization: name, email, source, notes must contain zero phone numbers / raw email
    IF v_row.email <> '***@***.***' THEN
        RAISE EXCEPTION 'Email was not masked, got: %', v_row.email;
    END IF;
    IF v_row.name <> 'Vikramaditya S.' THEN
        RAISE EXCEPTION 'Name was not formatted to First Name + Last Initial, got: %', v_row.name;
    END IF;
    IF v_row.name ~ '[0-9]' THEN
        RAISE EXCEPTION 'Name unexpectedly contains digits: %', v_row.name;
    END IF;
    IF v_row.source ~ '[0-9]' THEN
        RAISE EXCEPTION 'Source unexpectedly contains digits: %', v_row.source;
    END IF;
    IF v_row.notes ~ '[0-9]' THEN
        RAISE EXCEPTION 'Notes unexpectedly contain digits: %', v_row.notes;
    END IF;

    -- Disabled telecaller gets zero rows
    SELECT count(*) INTO v_count
      FROM public.server_get_assigned_telecaller_leads(
          'a7000000-0000-4000-8000-000000000012',
          'a7000000-0000-4000-8000-000000000102',
          'a7000000-0000-4000-8000-000000000001'
      );
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Disabled telecaller unexpectedly retrieved leads: count=%', v_count;
    END IF;

    -- Owner profile gets zero rows
    SELECT count(*) INTO v_count
      FROM public.server_get_assigned_telecaller_leads(
          'a7000000-0000-4000-8000-000000000013',
          'a7000000-0000-4000-8000-000000000103',
          'a7000000-0000-4000-8000-000000000001'
      );
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Owner unexpectedly retrieved leads from telecaller read function: count=%', v_count;
    END IF;

    -- Mismatched tenant / user parameters get zero rows
    SELECT count(*) INTO v_count
      FROM public.server_get_assigned_telecaller_leads(
          'a7000000-0000-4000-8000-000000000011',
          'a7000000-0000-4000-8000-000000000101',
          'a7000000-0000-4000-8000-000000000002' -- Wrong org
      );
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Mismatched org parameter unexpectedly retrieved rows: count=%', v_count;
    END IF;
END;
$$;

-- Test 4B: server_update_assigned_telecaller_lead updates status and notes safely
DO $$
DECLARE
    v_result BOOLEAN;
    v_updated_lead RECORD;
BEGIN
    -- Valid update on assigned lead succeeds
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000011',
        'a7000000-0000-4000-8000-000000000101',
        'a7000000-0000-4000-8000-000000000001',
        'a7000000-0000-4000-8000-000000000201',
        'CONTACTED',
        'Spoke with candidate. Verified course interest.'
    );
    IF v_result IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'server_update_assigned_telecaller_lead failed on valid assigned lead';
    END IF;

    SELECT * INTO v_updated_lead FROM public.leads WHERE id = 'a7000000-0000-4000-8000-000000000201';
    IF v_updated_lead.status <> 'CONTACTED' THEN
        RAISE EXCEPTION 'Lead status was not updated, got: %', v_updated_lead.status;
    END IF;
    IF v_updated_lead.notes <> 'Spoke with candidate. Verified course interest.' THEN
        RAISE EXCEPTION 'Lead notes were not updated, got: %', v_updated_lead.notes;
    END IF;

    -- Verify critical boundary: phone, tenant, assignment, priority are UNTOUCHED
    IF v_updated_lead.phone <> '+919876543210' THEN
        RAISE EXCEPTION 'Phone was modified during update!';
    END IF;
    IF v_updated_lead.organization_id <> 'a7000000-0000-4000-8000-000000000001' THEN
        RAISE EXCEPTION 'Organization ID was modified during update!';
    END IF;
    IF v_updated_lead.assigned_to <> 'a7000000-0000-4000-8000-000000000101' THEN
        RAISE EXCEPTION 'Assigned profile was modified during update!';
    END IF;
    IF v_updated_lead.priority <> 'HIGH' THEN
        RAISE EXCEPTION 'Priority was modified during update!';
    END IF;

    -- Update on unassigned lead returns FALSE
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000011',
        'a7000000-0000-4000-8000-000000000101',
        'a7000000-0000-4000-8000-000000000001',
        'a7000000-0000-4000-8000-000000000202',
        'CONTACTED',
        'Attempt'
    );
    IF v_result IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Update on unassigned lead did not return FALSE';
    END IF;

    -- Update on cross-org lead returns FALSE
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000011',
        'a7000000-0000-4000-8000-000000000101',
        'a7000000-0000-4000-8000-000000000001',
        'a7000000-0000-4000-8000-000000000203',
        'CONTACTED',
        'Attempt'
    );
    IF v_result IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Update on cross-org lead did not return FALSE';
    END IF;

    -- Update on colleague's lead in same org returns FALSE
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000011',
        'a7000000-0000-4000-8000-000000000101',
        'a7000000-0000-4000-8000-000000000001',
        'a7000000-0000-4000-8000-000000000204',
        'CONTACTED',
        'Attempt'
    );
    IF v_result IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Update on colleague lead did not return FALSE';
    END IF;

    -- Update with disabled telecaller identity returns FALSE
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000012',
        'a7000000-0000-4000-8000-000000000102',
        'a7000000-0000-4000-8000-000000000001',
        'a7000000-0000-4000-8000-000000000205',
        'CONTACTED',
        'Attempt'
    );
    IF v_result IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Update by disabled telecaller did not return FALSE';
    END IF;

    -- Update with invalid status enum value returns FALSE
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000011',
        'a7000000-0000-4000-8000-000000000101',
        'a7000000-0000-4000-8000-000000000001',
        'a7000000-0000-4000-8000-000000000201',
        'MALICIOUS_STATUS',
        'Attempt'
    );
    IF v_result IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Update with invalid status did not return FALSE';
    END IF;

    -- Update with NULL lead ID returns FALSE
    v_result := public.server_update_assigned_telecaller_lead(
        'a7000000-0000-4000-8000-000000000011',
        'a7000000-0000-4000-8000-000000000101',
        'a7000000-0000-4000-8000-000000000001',
        NULL,
        'CONTACTED',
        'Attempt'
    );
    IF v_result IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Update with NULL lead_id did not return FALSE';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. CLEAN ROLLBACK
-- ----------------------------------------------------------------------------
ROLLBACK;
\echo 'Phase 24.7 server telecaller lead test suite passed; all fixtures rolled back.'
