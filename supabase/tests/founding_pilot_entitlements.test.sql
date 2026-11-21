-- Run with psql against a disposable Supabase-compatible database after the
-- billing foundation, 20261031170000, 20261031180000 and 20261104120000.
-- All fixtures are transaction-scoped and rolled back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('a4410000-0000-4000-8000-000000000001','authenticated','authenticated','pilot-admin@example.test','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('a4410000-0000-4000-8000-000000000002','authenticated','authenticated','pilot-owner-a@example.test','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('a4410000-0000-4000-8000-000000000003','authenticated','authenticated','pilot-owner-b@example.test','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('a4410000-0000-4000-8000-000000000004','authenticated','authenticated','pilot-owner-c@example.test','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('a4410000-0000-4000-8000-000000000005','authenticated','authenticated','pilot-owner-d@example.test','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('a4410000-0000-4000-8000-000000000006','authenticated','authenticated','pilot-owner-expired@example.test','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now());

INSERT INTO public.profiles (id, user_id, organization_id, full_name, role, status)
VALUES
  ('a4420000-0000-4000-8000-000000000001','a4410000-0000-4000-8000-000000000001',NULL,'Pilot admin candidate','OWNER','ACTIVE'),
  ('a4420000-0000-4000-8000-000000000002','a4410000-0000-4000-8000-000000000002',NULL,'Pilot owner A','OWNER','ACTIVE'),
  ('a4420000-0000-4000-8000-000000000003','a4410000-0000-4000-8000-000000000003',NULL,'Pilot owner B','OWNER','ACTIVE'),
  ('a4420000-0000-4000-8000-000000000004','a4410000-0000-4000-8000-000000000004',NULL,'Pilot owner C','OWNER','ACTIVE'),
  ('a4420000-0000-4000-8000-000000000005','a4410000-0000-4000-8000-000000000005',NULL,'Pilot owner D','OWNER','ACTIVE'),
  ('a4420000-0000-4000-8000-000000000006','a4410000-0000-4000-8000-000000000006',NULL,'Pilot owner Expired','OWNER','ACTIVE');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', TRUE);
SELECT public.grant_platform_admin('a4420000-0000-4000-8000-000000000001');
RESET ROLE;

INSERT INTO public.organizations (id, name, slug, owner_id)
VALUES
 ('a4430000-0000-4000-8000-000000000001','Pilot A','founding-pilot-a','a4420000-0000-4000-8000-000000000002'),
 ('a4430000-0000-4000-8000-000000000002','Pilot B','founding-pilot-b','a4420000-0000-4000-8000-000000000003'),
 ('a4430000-0000-4000-8000-000000000003','Pilot C','founding-pilot-c','a4420000-0000-4000-8000-000000000004'),
  ('a4430000-0000-4000-8000-000000000004','Pilot D','founding-pilot-d','a4420000-0000-4000-8000-000000000005'),
  ('a4430000-0000-4000-8000-000000000005','Expired pilot','founding-pilot-expired','a4420000-0000-4000-8000-000000000006');

DO $test$
DECLARE
  v_a UUID := 'a4430000-0000-4000-8000-000000000001';
  v_b UUID := 'a4430000-0000-4000-8000-000000000002';
  v_c UUID := 'a4430000-0000-4000-8000-000000000003';
  v_d UUID := 'a4430000-0000-4000-8000-000000000004';
  v_expired UUID := 'a4430000-0000-4000-8000-000000000005';
  v_admin UUID := 'a4420000-0000-4000-8000-000000000001';
  v_owner UUID := 'a4420000-0000-4000-8000-000000000002';
  v_a_grant UUID;
  v_b_grant UUID;
  v_c_grant UUID;
  v_d_grant UUID;
  v_function REGPROCEDURE := 'public.organization_has_active_paid_entitlement(uuid)'::REGPROCEDURE;
BEGIN
  IF NOT (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
            FROM pg_catalog.pg_proc p WHERE p.oid = v_function) THEN
    RAISE EXCEPTION 'Paid entitlement RPC lost SECURITY DEFINER or restricted search_path';
  END IF;
  IF has_function_privilege('anon', v_function, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Paid entitlement RPC must remain service_role-only';
  END IF;
  IF has_table_privilege('service_role', 'public.organization_pilot_entitlements', 'SELECT')
     OR has_table_privilege('service_role', 'public.organization_pilot_entitlement_events', 'SELECT') THEN
    RAISE EXCEPTION 'Service role must use controlled RPCs and have no direct pilot table reads';
  END IF;

  -- Expired fixture confirms the entitlement read itself checks time, not just
  -- whether an organization has ever received a grant.
  INSERT INTO public.organization_pilot_entitlements (
    organization_id, granted_by, granted_at, expires_at, grant_reason
  ) VALUES (v_expired, v_admin, pg_catalog.now() - INTERVAL '2 days',
            pg_catalog.now() - INTERVAL '1 day', 'Expired fixture grant');
  IF public.organization_has_active_paid_entitlement(v_expired) IS NOT FALSE THEN
    RAISE EXCEPTION 'Expired pilot grant was treated as active';
  END IF;

  v_a_grant := public.grant_founding_pilot_entitlement(v_a, v_admin, pg_catalog.now() + INTERVAL '180 days', 'Verified founding pilot invoice A');
  v_b_grant := public.grant_founding_pilot_entitlement(v_b, v_admin, pg_catalog.now() + INTERVAL '180 days', 'Verified founding pilot invoice B');
  v_c_grant := public.grant_founding_pilot_entitlement(v_c, v_admin, pg_catalog.now() + INTERVAL '180 days', 'Verified founding pilot invoice C');

  IF public.organization_has_active_paid_entitlement(v_a) IS NOT TRUE THEN RAISE EXCEPTION 'Active pilot org A was denied'; END IF;
  IF public.organization_has_active_paid_entitlement(v_b) IS NOT TRUE THEN RAISE EXCEPTION 'Active pilot org B was denied'; END IF;
  IF public.organization_has_active_paid_entitlement(v_d) IS NOT FALSE THEN RAISE EXCEPTION 'Unentitled org D was granted access'; END IF;

  BEGIN
    PERFORM public.grant_founding_pilot_entitlement(v_d, v_admin, pg_catalog.now() + INTERVAL '180 days', 'Verified founding pilot invoice D');
    RAISE EXCEPTION 'Fourth active pilot organization unexpectedly exceeded the cap';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    PERFORM public.grant_founding_pilot_entitlement(v_d, v_owner, pg_catalog.now() + INTERVAL '180 days', 'Owner cannot grant pilot access');
    RAISE EXCEPTION 'Non-admin profile unexpectedly granted pilot access';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF public.revoke_founding_pilot_entitlement(v_b, v_b_grant, v_admin, 'Pilot invoice was reversed') IS NOT TRUE THEN
    RAISE EXCEPTION 'Active pilot could not be revoked';
  END IF;
  IF public.organization_has_active_paid_entitlement(v_b) IS NOT FALSE THEN RAISE EXCEPTION 'Revoked pilot remained entitled'; END IF;

  v_d_grant := public.grant_founding_pilot_entitlement(v_d, v_admin, pg_catalog.now() + INTERVAL '180 days', 'Verified founding pilot invoice D');
  IF public.organization_has_active_paid_entitlement(v_d) IS NOT TRUE THEN RAISE EXCEPTION 'Replacement pilot grant was denied'; END IF;

  IF (SELECT pg_catalog.count(*) FROM public.organization_pilot_entitlement_events
       WHERE organization_id IN (v_a,v_b,v_c,v_d)) <> 5 THEN
    RAISE EXCEPTION 'Grant and revoke audit events are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_pilot_entitlements e
     WHERE e.id IN (v_a_grant,v_b_grant,v_c_grant,v_d_grant)
       AND (e.expires_at > e.granted_at + INTERVAL '365 days' OR e.granted_by <> v_admin)
  ) THEN RAISE EXCEPTION 'Grant attribution or maximum duration is invalid'; END IF;
END;
$test$;

ROLLBACK;
