-- Run only against the local Supabase database after the migration. This is a
-- psql script (uses \set and is not a pgTAP test):
-- psql -X -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/lead_refresh_signals.test.sql
-- All auth users, organizations, profiles, signal rows and lead writes are
-- inside one transaction and are rolled back at the end.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE lead_refresh_test_fixture (
  org_one uuid NOT NULL,
  org_two uuid NOT NULL,
  owner_user uuid NOT NULL,
  owner_profile uuid NOT NULL,
  admin_user uuid NOT NULL,
  admin_profile uuid NOT NULL,
  caller_one_user uuid NOT NULL,
  caller_one_profile uuid NOT NULL,
  caller_two_user uuid NOT NULL,
  caller_two_profile uuid NOT NULL,
  inactive_user uuid NOT NULL,
  inactive_profile uuid NOT NULL,
  other_owner_user uuid NOT NULL,
  other_owner_profile uuid NOT NULL,
  other_caller_user uuid NOT NULL,
  other_caller_profile uuid NOT NULL,
  lead_one uuid NOT NULL,
  lead_two uuid NOT NULL,
  lead_inactive uuid NOT NULL,
  lead_auth_insert uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO lead_refresh_test_fixture
SELECT
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4(),
  extensions.uuid_generate_v4(), extensions.uuid_generate_v4();

GRANT SELECT ON TABLE lead_refresh_test_fixture TO anon, authenticated, service_role;

DO $$
DECLARE
  f record;
  v_function_security_definer boolean;
  v_function_config text[];
  v_published_columns name[];
  v_column_count integer;
  v_revision bigint;
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_replica_identity text;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;

  -- Catalog and effective permission assertions.
  IF NOT has_table_privilege('authenticated', 'public.lead_refresh_signals', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.lead_refresh_signals', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated or service_role cannot read refresh cursors';
  END IF;
  IF has_table_privilege('anon', 'public.lead_refresh_signals', 'SELECT')
     OR has_table_privilege('anon', 'public.lead_refresh_signals', 'INSERT')
     OR has_table_privilege('anon', 'public.lead_refresh_signals', 'UPDATE')
     OR has_table_privilege('anon', 'public.lead_refresh_signals', 'DELETE')
     OR has_table_privilege('anon', 'public.lead_refresh_signals', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.lead_refresh_signals', 'REFERENCES')
     OR has_table_privilege('anon', 'public.lead_refresh_signals', 'TRIGGER') THEN
    RAISE EXCEPTION 'anon has a direct refresh-signal privilege';
  END IF;
  IF has_table_privilege('authenticated', 'public.lead_refresh_signals', 'INSERT')
     OR has_table_privilege('authenticated', 'public.lead_refresh_signals', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.lead_refresh_signals', 'DELETE')
     OR has_table_privilege('authenticated', 'public.lead_refresh_signals', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.lead_refresh_signals', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.lead_refresh_signals', 'TRIGGER') THEN
    RAISE EXCEPTION 'authenticated has a refresh-signal write privilege';
  END IF;
  IF has_table_privilege('service_role', 'public.lead_refresh_signals', 'INSERT')
     OR has_table_privilege('service_role', 'public.lead_refresh_signals', 'UPDATE')
     OR has_table_privilege('service_role', 'public.lead_refresh_signals', 'DELETE')
     OR has_table_privilege('service_role', 'public.lead_refresh_signals', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.lead_refresh_signals', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.lead_refresh_signals', 'TRIGGER') THEN
    RAISE EXCEPTION 'service_role has direct refresh-signal write privileges';
  END IF;
  IF has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence('public.lead_refresh_signals', 'id'), 'USAGE'
     )
     OR has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence('public.lead_refresh_signals', 'id'), 'USAGE'
     )
     OR has_sequence_privilege(
       'service_role', pg_catalog.pg_get_serial_sequence('public.lead_refresh_signals', 'id'), 'USAGE'
     ) THEN
    RAISE EXCEPTION 'an API role has direct access to the signal identity sequence';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity, c.relreplident::text
    INTO STRICT v_rls_enabled, v_rls_forced, v_replica_identity
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = 'public.lead_refresh_signals'::regclass;
  IF v_rls_enabled IS DISTINCT FROM TRUE
     OR v_rls_forced IS DISTINCT FROM FALSE
     OR v_replica_identity IS DISTINCT FROM 'd' THEN
    RAISE EXCEPTION 'signal table RLS or replica identity is incorrect';
  END IF;

  SELECT count(*) INTO v_column_count
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'lead_refresh_signals';
  IF v_column_count <> 5 OR EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'lead_refresh_signals'
       AND column_name IN (
         'name', 'phone', 'email', 'notes', 'metadata', 'lead_name', 'lead_phone'
       )
  ) THEN
    RAISE EXCEPTION 'signal table includes unexpected or sensitive columns';
  END IF;

  IF has_function_privilege('anon', 'public.bump_lead_refresh_signal(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.bump_lead_refresh_signal(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.bump_lead_refresh_signal(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.emit_lead_refresh_signal()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.emit_lead_refresh_signal()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.emit_lead_refresh_signal()', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal signal functions are directly executable by an API role';
  END IF;

  SELECT p.prosecdef, p.proconfig
    INTO v_function_security_definer, v_function_config
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.emit_lead_refresh_signal()'::regprocedure;
  IF v_function_security_definer IS DISTINCT FROM TRUE
     OR NOT COALESCE(
       array_to_string(v_function_config, ';') LIKE '%search_path=pg_catalog, pg_temp%',
       FALSE
     ) THEN
    RAISE EXCEPTION 'lead signal trigger lacks SECURITY DEFINER or restricted search_path';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = 'public.bump_lead_refresh_signal(uuid,uuid)'::regprocedure
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'cursor helper lacks SECURITY DEFINER or restricted search_path';
  END IF;
  IF (SELECT p.proowner FROM pg_catalog.pg_proc AS p
       WHERE p.oid = 'public.emit_lead_refresh_signal()'::regprocedure)
       <> (SELECT c.relowner FROM pg_catalog.pg_class AS c
            WHERE c.oid = 'public.lead_refresh_signals'::regclass)
     OR (SELECT p.proowner FROM pg_catalog.pg_proc AS p
          WHERE p.oid = 'public.bump_lead_refresh_signal(uuid,uuid)'::regprocedure)
       <> (SELECT c.relowner FROM pg_catalog.pg_class AS c
            WHERE c.oid = 'public.lead_refresh_signals'::regclass) THEN
    RAISE EXCEPTION 'signal functions and signal table do not share the expected trusted owner';
  END IF;
  IF NOT has_function_privilege(
       (SELECT p.proowner FROM pg_catalog.pg_proc AS p
         WHERE p.oid = 'public.bump_lead_refresh_signal(uuid,uuid)'::regprocedure),
       'public.bump_lead_refresh_signal(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'trusted signal function owner cannot execute the internal cursor helper';
  END IF;

  SELECT attnames INTO v_published_columns
    FROM pg_catalog.pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename = 'lead_refresh_signals';
  IF v_published_columns IS NULL
     OR cardinality(v_published_columns) <> 5
     OR NOT (v_published_columns @> ARRAY[
       'id'::name, 'organization_id'::name, 'recipient_profile_id'::name,
       'revision'::name, 'updated_at'::name
     ]) THEN
    RAISE EXCEPTION 'Realtime signal publication columns are missing or unexpected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'leads'
  ) THEN
    RAISE EXCEPTION 'raw public.leads remains in supabase_realtime';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.leads'::regclass
       AND tgname = 'trg_leads_emit_sanitized_refresh_signal'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'lead refresh trigger is missing';
  END IF;

  INSERT INTO public.organizations (id, name, slug, owner_id) VALUES
    (f.org_one, 'Refresh Test One', 'refresh-one-' || f.org_one::text, f.owner_user),
    (f.org_two, 'Refresh Test Two', 'refresh-two-' || f.org_two::text, f.other_owner_user);

  -- Match every ENCRIX profile user_id to an auth.users identity. The
  -- application schema intentionally has no FK for this relationship, but
  -- real authenticated JWT identities must still correspond to auth.users.
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) VALUES
    (f.owner_user, 'authenticated', 'authenticated', f.owner_user::text || '@refresh.example.test', '', now(), now(), now()),
    (f.admin_user, 'authenticated', 'authenticated', f.admin_user::text || '@refresh.example.test', '', now(), now(), now()),
    (f.caller_one_user, 'authenticated', 'authenticated', f.caller_one_user::text || '@refresh.example.test', '', now(), now(), now()),
    (f.caller_two_user, 'authenticated', 'authenticated', f.caller_two_user::text || '@refresh.example.test', '', now(), now(), now()),
    (f.inactive_user, 'authenticated', 'authenticated', f.inactive_user::text || '@refresh.example.test', '', now(), now(), now()),
    (f.other_owner_user, 'authenticated', 'authenticated', f.other_owner_user::text || '@refresh.example.test', '', now(), now(), now()),
    (f.other_caller_user, 'authenticated', 'authenticated', f.other_caller_user::text || '@refresh.example.test', '', now(), now(), now());

  INSERT INTO public.profiles (id, user_id, organization_id, full_name, role, status) VALUES
    (f.owner_profile, f.owner_user, f.org_one, 'Refresh Owner', 'OWNER', 'ACTIVE'),
    (f.admin_profile, f.admin_user, f.org_one, 'Refresh Admin', 'OWNER', 'ACTIVE'),
    (f.caller_one_profile, f.caller_one_user, f.org_one, 'Refresh Caller One', 'TELECALLER', 'ACTIVE'),
    (f.caller_two_profile, f.caller_two_user, f.org_one, 'Refresh Caller Two', 'TELECALLER', 'ACTIVE'),
    (f.inactive_profile, f.inactive_user, f.org_one, 'Refresh Inactive Caller', 'TELECALLER', 'DISABLED'),
    (f.other_owner_profile, f.other_owner_user, f.org_two, 'Other Refresh Owner', 'OWNER', 'ACTIVE'),
    (f.other_caller_profile, f.other_caller_user, f.org_two, 'Other Refresh Caller', 'TELECALLER', 'ACTIVE');

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM public.grant_platform_admin(f.admin_profile);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', TRUE);

  INSERT INTO public.leads (
    id, organization_id, lead_code, name, phone, email, assigned_to, notes
  ) VALUES (
    f.lead_one, f.org_one, 'RF-' || f.lead_one::text,
    'Sensitive Fixture Name', '+91 90000 00111', 'private-one@example.test',
    f.caller_one_profile, 'Sensitive fixture note'
  );

  SELECT revision INTO STRICT v_revision
    FROM public.lead_refresh_signals
   WHERE organization_id = f.org_one AND recipient_profile_id = f.caller_one_profile;
  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'initial assigned telecaller cursor should start at revision 1';
  END IF;

  -- Reassignment advances organization scope, old assignee, and new assignee.
  UPDATE public.leads SET assigned_to = f.caller_two_profile WHERE id = f.lead_one;
  IF (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id IS NULL) <> 2
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id = f.caller_one_profile) <> 2
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id = f.caller_two_profile) <> 1 THEN
    RAISE EXCEPTION 'reassignment did not advance organization, previous, and new recipient cursors';
  END IF;

  -- Ordinary update advances the current assignee and organization cursor.
  UPDATE public.leads SET status = 'CONTACTED' WHERE id = f.lead_one;
  IF (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id IS NULL) <> 3
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id = f.caller_two_profile) <> 2 THEN
    RAISE EXCEPTION 'ordinary update did not advance the organization and current assignee';
  END IF;

  -- Move the lead across tenants. Both organization cursors and both
  -- telecaller cursors must advance so neither tenant keeps stale assignment
  -- state. The old assignee is scoped to org_one; the new one to org_two.
  UPDATE public.leads
     SET organization_id = f.org_two, assigned_to = f.other_caller_profile
   WHERE id = f.lead_one;
  IF (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id IS NULL) <> 4
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_two AND recipient_profile_id IS NULL) <> 1
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id = f.caller_two_profile) <> 3
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_two AND recipient_profile_id = f.other_caller_profile) <> 1 THEN
    RAISE EXCEPTION 'organization move did not advance both organization and both assignee cursors';
  END IF;

  DELETE FROM public.leads WHERE id = f.lead_one;
  IF (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_two AND recipient_profile_id IS NULL) <> 2
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_two AND recipient_profile_id = f.other_caller_profile) <> 2 THEN
    RAISE EXCEPTION 'deletion after organization move did not advance destination cursors';
  END IF;

  INSERT INTO public.leads (
    id, organization_id, lead_code, name, phone, email, assigned_to, notes
  ) VALUES (
    f.lead_two, f.org_two, 'RF-' || f.lead_two::text,
    'Other Sensitive Fixture', '+91 90000 00222', 'private-two@example.test',
    f.other_caller_profile, 'Other sensitive fixture note'
  );
  INSERT INTO public.leads (
    id, organization_id, lead_code, name, phone, email, assigned_to, notes
  ) VALUES (
    f.lead_inactive, f.org_one, 'RF-' || f.lead_inactive::text,
    'Inactive Sensitive Fixture', '+91 90000 00333', 'private-three@example.test',
    f.inactive_profile, 'Inactive sensitive fixture note'
  );
END;
$$;

-- An owner sees exactly the organization cursor for its own organization.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  (SELECT pg_catalog.json_build_object('role', 'authenticated', 'sub', owner_user)::text
     FROM lead_refresh_test_fixture),
  true
);
DO $$
DECLARE
  f record;
  blocked boolean;
  v_count integer;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;
  SELECT count(*) INTO v_count FROM public.lead_refresh_signals;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.lead_refresh_signals
     WHERE organization_id = f.org_one AND recipient_profile_id IS NULL
  ) THEN
    RAISE EXCEPTION 'owner can read outside its organization or recipient scopes';
  END IF;

  blocked := FALSE;
  BEGIN
    PERFORM public.bump_lead_refresh_signal(f.org_one, f.caller_one_profile);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := TRUE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated owner directly invoked the internal cursor function';
  END IF;

  blocked := FALSE;
  BEGIN
    PERFORM public.emit_lead_refresh_signal();
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := TRUE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated owner directly invoked the trigger function';
  END IF;

  blocked := FALSE;
  BEGIN
    INSERT INTO public.lead_refresh_signals (organization_id, recipient_profile_id)
    VALUES (f.org_one, f.caller_one_profile);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := TRUE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated owner forged a refresh signal';
  END IF;

  IF has_table_privilege(current_user, 'public.lead_refresh_signals', 'INSERT')
     OR has_table_privilege(current_user, 'public.lead_refresh_signals', 'UPDATE')
     OR has_table_privilege(current_user, 'public.lead_refresh_signals', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated owner has signal table write privilege';
  END IF;
END;
$$;
RESET ROLE;

-- Browser roles cannot insert leads directly after privilege hardening.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $direct_insert$
DECLARE
  f record;
  blocked boolean := FALSE;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;
  BEGIN
    INSERT INTO public.leads (
      id, organization_id, lead_code, name, phone, email, assigned_to
    ) VALUES (
      f.lead_auth_insert, f.org_one, 'RF-AUTH-' || f.lead_auth_insert::text,
      'Authenticated fixture', '+91 90000 00444', 'auth-lead@example.test', f.caller_one_profile
    );
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := TRUE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated owner unexpectedly inserted a lead directly';
  END IF;
END;
$direct_insert$;
RESET ROLE;

-- The authorized server RPC reaches the lead trigger with the internal
-- refresh-signal writer restricted from direct API execution.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT public.create_owner_lead(
  org_one, owner_profile, 'Authorized fixture', '+91 90000 00444',
  'auth-lead@example.test', 'Direct', 'MEDIUM', NULL, caller_one_profile
)
FROM lead_refresh_test_fixture;
RESET ROLE;
DO $$
DECLARE
  f record;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;
  IF (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id IS NULL) <> 6
     OR (SELECT revision FROM public.lead_refresh_signals
       WHERE organization_id = f.org_one AND recipient_profile_id = f.caller_one_profile) <> 3 THEN
    RAISE EXCEPTION 'authenticated owner lead insert did not reach trigger with internal EXECUTE revoked';
  END IF;
END;
$$;

-- Admins are also restricted to their own profile organization.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  (SELECT pg_catalog.json_build_object('role', 'authenticated', 'sub', admin_user)::text
     FROM lead_refresh_test_fixture),
  true
);
DO $$
DECLARE
  f record;
  v_count integer;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;
  SELECT count(*) INTO v_count FROM public.lead_refresh_signals;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.lead_refresh_signals
     WHERE organization_id = f.org_one AND recipient_profile_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.lead_refresh_signals
     WHERE organization_id = f.org_two
  ) THEN
    RAISE EXCEPTION 'admin can read refresh signals outside its organization';
  END IF;
END;
$$;
RESET ROLE;

-- Active telecallers see only their own recipient cursor, not the organization
-- cursor or another telecaller's cursor.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  (SELECT pg_catalog.json_build_object('role', 'authenticated', 'sub', caller_one_user)::text
     FROM lead_refresh_test_fixture),
  true
);
DO $$
DECLARE
  f record;
  v_count integer;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;
  SELECT count(*) INTO v_count FROM public.lead_refresh_signals;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.lead_refresh_signals
     WHERE organization_id = f.org_one
       AND recipient_profile_id = f.caller_one_profile
  ) THEN
    RAISE EXCEPTION 'telecaller can read another recipient or organization cursor';
  END IF;
END;
$$;
RESET ROLE;

-- An inactive telecaller and a telecaller from another tenant see no rows.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  (SELECT pg_catalog.json_build_object('role', 'authenticated', 'sub', inactive_user)::text
     FROM lead_refresh_test_fixture),
  true
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lead_refresh_signals) THEN
    RAISE EXCEPTION 'inactive telecaller can read refresh signals';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  (SELECT pg_catalog.json_build_object('role', 'authenticated', 'sub', other_caller_user)::text
     FROM lead_refresh_test_fixture),
  true
);
DO $$
DECLARE
  f record;
  v_count integer;
BEGIN
  SELECT * INTO STRICT f FROM lead_refresh_test_fixture;
  SELECT count(*) INTO v_count FROM public.lead_refresh_signals;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.lead_refresh_signals
     WHERE organization_id = f.org_two
       AND recipient_profile_id = f.other_caller_profile
  ) THEN
    RAISE EXCEPTION 'other-organization telecaller can read out-of-scope cursors';
  END IF;
END;
$$;
RESET ROLE;

-- Anonymous has neither table access nor visible rows.
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config(
  'request.jwt.claims', '{"role":"anon"}', true
);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.lead_refresh_signals;
    RAISE EXCEPTION 'anon unexpectedly queried refresh signals';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

ROLLBACK;
