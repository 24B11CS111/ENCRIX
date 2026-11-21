-- Local PostgreSQL regression tests for Phase 24.3.
-- Run after `npx supabase db reset --local`. All fixtures are rolled back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations(id, name, slug, owner_id) VALUES
('a3000000-0000-4000-8000-000000000001', 'Phase 24.3 Org A', 'phase243-a', 'a3000000-0000-4000-8000-000000000011'),
('a3000000-0000-4000-8000-000000000002', 'Phase 24.3 Org B', 'phase243-b', 'a3000000-0000-4000-8000-000000000012');

INSERT INTO public.profiles(id, user_id, organization_id, full_name, role, status, phone, phone_verified) VALUES
('a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000011', 'a3000000-0000-4000-8000-000000000001', 'Owner A', 'OWNER', 'ACTIVE', NULL, FALSE),
('a3000000-0000-4000-8000-000000000102', 'a3000000-0000-4000-8000-000000000013', 'a3000000-0000-4000-8000-000000000001', 'Active caller A', 'TELECALLER', 'ACTIVE', NULL, FALSE),
('a3000000-0000-4000-8000-000000000103', 'a3000000-0000-4000-8000-000000000014', 'a3000000-0000-4000-8000-000000000001', 'Inactive caller A', 'TELECALLER', 'DISABLED', NULL, FALSE),
('a3000000-0000-4000-8000-000000000104', 'a3000000-0000-4000-8000-000000000012', 'a3000000-0000-4000-8000-000000000002', 'Owner B', 'OWNER', 'ACTIVE', NULL, FALSE),
('a3000000-0000-4000-8000-000000000105', 'a3000000-0000-4000-8000-000000000015', 'a3000000-0000-4000-8000-000000000002', 'Caller B', 'TELECALLER', 'ACTIVE', NULL, FALSE);

INSERT INTO public.leads(id, organization_id, lead_code, name, phone, email, source, status, priority, assigned_to, notes) VALUES
('a3000000-0000-4000-8000-000000000201', 'a3000000-0000-4000-8000-000000000001', 'P243-A1', 'Alicia Example 9876543210', '+19990000001', 'private@example.invalid', 'Referral 9876543210', 'NEW', 'MEDIUM', 'a3000000-0000-4000-8000-000000000102', 'Initial note 9876543210'),
('a3000000-0000-4000-8000-000000000202', 'a3000000-0000-4000-8000-000000000001', 'P243-A2', 'Unassigned Example', '+19990000002', 'unassigned@example.invalid', 'Direct', 'NEW', 'LOW', NULL, 'Private note'),
('a3000000-0000-4000-8000-000000000203', 'a3000000-0000-4000-8000-000000000002', 'P243-B1', 'Other Tenant Example', '+19990000003', 'other@example.invalid', 'Direct', 'NEW', 'LOW', 'a3000000-0000-4000-8000-000000000105', 'Private note'),
('a3000000-0000-4000-8000-000000000204', 'a3000000-0000-4000-8000-000000000001', 'P243-A3', 'Inactive Assigned Example', '+19990000004', 'inactive@example.invalid', 'Direct', 'NEW', 'LOW', 'a3000000-0000-4000-8000-000000000103', 'Private note');

-- Browser roles use authenticated APIs/RPCs and have no direct raw-lead access.
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

-- The assigned active telecaller can read only the established safe view.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000013';
SET LOCAL request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000013","role":"authenticated"}';
DO $$
DECLARE
    v_row RECORD;
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.telecaller_leads_view;
    IF v_count <> 1 THEN RAISE EXCEPTION 'assigned active projection count expected 1, got %', v_count; END IF;
    IF (SELECT count(*) FROM public.telecaller_leads_view
         WHERE id IN ('a3000000-0000-4000-8000-000000000202', 'a3000000-0000-4000-8000-000000000203')) <> 0 THEN
        RAISE EXCEPTION 'unassigned or cross-organization lead appeared in projection';
    END IF;

    SELECT * INTO v_row FROM public.telecaller_leads_view
     WHERE id = 'a3000000-0000-4000-8000-000000000201';
    IF NOT FOUND THEN RAISE EXCEPTION 'assigned lead projection missing'; END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'telecaller_leads_view'
           AND column_name IN ('phone', 'metadata')
    ) THEN RAISE EXCEPTION 'view unexpectedly exposes a raw protected column'; END IF;
    IF v_row.email <> '***@***.***' THEN RAISE EXCEPTION 'view unexpectedly exposes email'; END IF;
    IF v_row.name LIKE '%9876543210%' OR v_row.source LIKE '%9876543210%' OR v_row.notes LIKE '%9876543210%' THEN
        RAISE EXCEPTION 'view failed to sanitize phone-like free text';
    END IF;
    IF public.update_assigned_telecaller_lead(
        'a3000000-0000-4000-8000-000000000201', 'CONTACTED', 'Verified note 1234567890'
    ) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'assigned update RPC did not succeed'; END IF;
    IF public.update_assigned_telecaller_lead(
        'a3000000-0000-4000-8000-000000000202', 'CONTACTED', 'attempt'
    ) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'unassigned update was not denied'; END IF;
    IF public.update_assigned_telecaller_lead(
        'a3000000-0000-4000-8000-000000000203', 'CONTACTED', 'attempt'
    ) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'cross-organization update was not denied'; END IF;
    SELECT status, notes INTO v_row FROM public.telecaller_leads_view
     WHERE id = 'a3000000-0000-4000-8000-000000000201';
    IF v_row.status <> 'CONTACTED' OR v_row.notes ~ '[0-9]' THEN
        RAISE EXCEPTION 'permitted fields were not returned safely after update';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.telecaller_leads_view
         WHERE id = 'a3000000-0000-4000-8000-000000000201'
           AND status = 'CONTACTED'
           AND notes !~ '[0-9]'
    ) THEN RAISE EXCEPTION 'RPC status/notes update was not persisted in the safe view'; END IF;
END;
$$;

-- The trigger is exercised independently of RLS by the database owner while
-- carrying the same authenticated JWT identity. Protected changes must raise.
RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000013';
SET LOCAL request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000013","role":"authenticated"}';
DO $$
BEGIN
    BEGIN
        UPDATE public.leads SET phone = '+19990009999'
         WHERE id = 'a3000000-0000-4000-8000-000000000201';
        RAISE EXCEPTION 'protected phone update unexpectedly succeeded';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'protected phone update unexpectedly succeeded' THEN RAISE; END IF;
        IF SQLERRM <> 'Telecallers may update only lead status and notes.' THEN RAISE EXCEPTION 'phone guard rejected for unexpected reason'; END IF;
    END;
    BEGIN
        UPDATE public.leads SET organization_id = 'a3000000-0000-4000-8000-000000000002'
         WHERE id = 'a3000000-0000-4000-8000-000000000201';
        RAISE EXCEPTION 'protected organization update unexpectedly succeeded';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'protected organization update unexpectedly succeeded' THEN RAISE; END IF;
        IF SQLERRM <> 'Telecallers may update only lead status and notes.' THEN RAISE EXCEPTION 'organization guard rejected for unexpected reason'; END IF;
    END;
    BEGIN
        UPDATE public.leads SET assigned_to = 'a3000000-0000-4000-8000-000000000105'
         WHERE id = 'a3000000-0000-4000-8000-000000000201';
        RAISE EXCEPTION 'protected assignment update unexpectedly succeeded';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'protected assignment update unexpectedly succeeded' THEN RAISE; END IF;
        IF SQLERRM <> 'Telecallers may update only lead status and notes.' THEN RAISE EXCEPTION 'assignment guard rejected for unexpected reason'; END IF;
    END;
    BEGIN
        UPDATE public.leads SET priority = 'URGENT'
         WHERE id = 'a3000000-0000-4000-8000-000000000201';
        RAISE EXCEPTION 'protected priority update unexpectedly succeeded';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'protected priority update unexpectedly succeeded' THEN RAISE; END IF;
        IF SQLERRM <> 'Telecallers may update only lead status and notes.' THEN RAISE EXCEPTION 'priority guard rejected for unexpected reason'; END IF;
    END;
END;
$$;

-- Inactive telecallers cannot read the view or use the update RPC.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000014';
SET LOCAL request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000014","role":"authenticated"}';
DO $$
BEGIN
    IF (SELECT count(*) FROM public.telecaller_leads_view) <> 0 THEN RAISE EXCEPTION 'inactive telecaller can read projection'; END IF;
    IF public.update_assigned_telecaller_lead(
        'a3000000-0000-4000-8000-000000000204', 'CONTACTED', 'attempt'
    ) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'inactive telecaller update was not denied'; END IF;
END;
$$;

-- Owner/admin cross-tenant detail authorization remains testable through its
-- explicitly granted, SECURITY DEFINER detail RPC; lead mutations are API tests.
RESET ROLE;
INSERT INTO public.profiles(id, user_id, organization_id, full_name, role, status, phone, phone_verified) VALUES
('a3000000-0000-4000-8000-000000000106', 'a3000000-0000-4000-8000-000000000016', 'a3000000-0000-4000-8000-000000000001', 'Admin candidate', 'TELECALLER', 'ACTIVE', NULL, FALSE);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT public.grant_platform_admin('a3000000-0000-4000-8000-000000000106');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000011';
SET LOCAL request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000011","role":"authenticated"}';
DO $$
DECLARE
    v_blocked BOOLEAN := FALSE;
BEGIN
    BEGIN
        PERFORM public.get_telecaller_student_detail('a3000000-0000-4000-8000-000000000203');
        RAISE EXCEPTION 'owner accessed cross-organization lead detail';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'Lead not found or unauthorized.' THEN
            v_blocked := TRUE;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'owner cross-organization detail access was not denied'; END IF;
END;
$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000016';
SET LOCAL request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000016","role":"authenticated"}';
DO $$
DECLARE
    v_detail JSONB;
BEGIN
    v_detail := public.get_telecaller_student_detail('a3000000-0000-4000-8000-000000000203');
    IF v_detail IS NULL THEN RAISE EXCEPTION 'platform admin could not read cross-organization lead detail'; END IF;
END;
$$;

-- Validate SECURITY DEFINER configuration and minimum function privileges.
RESET ROLE;
DO $$
DECLARE
    v_oid REGPROCEDURE := 'public.update_assigned_telecaller_lead(uuid,text,text)'::regprocedure;
BEGIN
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN RAISE EXCEPTION 'update RPC is not SECURITY DEFINER'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) THEN
        RAISE EXCEPTION 'update RPC does not pin safe search_path';
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR EXISTS (
            SELECT 1
              FROM pg_proc AS proc
              CROSS JOIN LATERAL aclexplode(
                  COALESCE(proc.proacl, acldefault('f', proc.proowner))
              ) AS acl
             WHERE proc.oid = v_oid
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'update RPC has an unexpected execute grant';
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated cannot execute update RPC';
    END IF;
    IF has_table_privilege('authenticated', 'public.leads', 'SELECT')
       OR has_table_privilege('authenticated', 'public.leads', 'INSERT')
       OR has_table_privilege('authenticated', 'public.leads', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.leads', 'DELETE') THEN
        RAISE EXCEPTION 'authenticated unexpectedly has direct public.leads privileges';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.update_assigned_telecaller_lead(uuid,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated cannot execute the assigned telecaller update RPC';
    END IF;
END;
$$;

ROLLBACK;
\echo 'Phase 24.3 local PostgreSQL checks passed; fixture transaction rolled back.'
