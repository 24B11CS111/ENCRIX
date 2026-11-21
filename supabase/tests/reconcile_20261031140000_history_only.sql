-- HISTORY-ONLY reconciliation for 20261031140000.
-- This script does not apply migration SQL or alter functions/grants/schema.
-- It inserts one row in supabase_migrations.schema_migrations only after all
-- database, history-schema, and function-state guards pass.
-- Verify the exact Docker container ID and the migration file SHA-256 in the
-- PowerShell wrapper before executing this file with psql inside the container.

BEGIN;

DO $reconcile$
DECLARE
  v_history_oid oid;
  v_column_count integer;
  v_version_attnum smallint;
  v_constraint_count integer;
  v_primary_key_count integer;
  v_history_count integer;
  v_inserted integer;
  v_function record;
  v_function_oid oid;
  v_owner oid;
  v_security_definer boolean;
  v_function_settings text[];
BEGIN
  -- The PowerShell wrapper enters the exact verified container. These checks
  -- additionally bind this transaction to the expected local database session.
  IF current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_setting('server_version_num')::integer IS DISTINCT FROM 170011
     OR current_setting('port') IS DISTINCT FROM '5432' THEN
    RAISE EXCEPTION 'Refusing reconciliation: unexpected database identity';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'Refusing reconciliation: required Supabase API roles are missing';
  END IF;

  v_history_oid := pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid;
  IF v_history_oid IS NULL THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid=v_history_oid AND c.relkind='r'
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history is not an ordinary table';
  END IF;

  -- Require exactly the verified three-column shape, with no generated or
  -- identity columns and no defaults that could change the inserted record.
  SELECT count(*)
    INTO v_column_count
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=v_history_oid AND a.attnum>0 AND NOT a.attisdropped;

  IF v_column_count IS DISTINCT FROM 3
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=v_history_oid AND a.attname='version'
          AND a.attnum>0 AND NOT a.attisdropped
          AND a.atttypid='pg_catalog.text'::pg_catalog.regtype
          AND a.attnotnull AND a.attidentity='' AND a.attgenerated=''
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=v_history_oid AND a.attname='statements'
          AND a.attnum>0 AND NOT a.attisdropped
          AND a.atttypid='pg_catalog.text[]'::pg_catalog.regtype
          AND NOT a.attnotnull AND a.attidentity='' AND a.attgenerated=''
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=v_history_oid AND a.attname='name'
          AND a.attnum>0 AND NOT a.attisdropped
          AND a.atttypid='pg_catalog.text'::pg_catalog.regtype
          AND NOT a.attnotnull AND a.attidentity='' AND a.attgenerated=''
     )
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=v_history_oid) THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history columns/defaults differ from the verified schema';
  END IF;

  SELECT a.attnum
    INTO v_version_attnum
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=v_history_oid AND a.attname='version'
     AND a.attnum>0 AND NOT a.attisdropped;

  SELECT count(*)
    INTO v_constraint_count
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid=v_history_oid;

  SELECT count(*)
    INTO v_primary_key_count
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid=v_history_oid AND c.contype='p'
     AND c.conkey=ARRAY[v_version_attnum]::smallint[];

  IF v_constraint_count IS DISTINCT FROM 1 OR v_primary_key_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history constraints differ from version PRIMARY KEY';
  END IF;

  -- Serialize history writers before the absence check. SHARE ROW EXCLUSIVE
  -- conflicts with the ROW EXCLUSIVE lock used by concurrent INSERTs while
  -- allowing ordinary readers. The lock is transaction-scoped.
  LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*)
    INTO v_history_count
    FROM supabase_migrations.schema_migrations h
   WHERE h.version='20261031140000';

  IF v_history_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Refusing reconciliation: version 20261031140000 is already present (count=%)', v_history_count;
  END IF;

  -- Compare all eight exact signatures with the migration's target path and
  -- the reviewed 24-entry API-role EXECUTE matrix in its SQL regression test.
  FOR v_function IN
    SELECT * FROM (VALUES
      ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)', false, true),
      ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)', false, true),
      ('public.can_access_call_recording(uuid,uuid)', false, true),
      ('public.can_access_call_recording(uuid)', true, true),
      ('public.can_access_call_recording_path(text)', true, true),
      ('public.get_telecaller_student_detail_legacy(uuid)', false, false),
      ('public.is_caller_active()', true, true),
      ('public.restrict_telecaller_lead_update_columns()', false, true)
    ) AS expected(signature, authenticated_execute, service_role_execute)
  LOOP
    v_function_oid := pg_catalog.to_regprocedure(v_function.signature)::oid;
    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION 'Refusing reconciliation: function signature % is missing', v_function.signature;
    END IF;

    SELECT p.proowner, p.prosecdef, p.proconfig
      INTO v_owner, v_security_definer, v_function_settings
      FROM pg_catalog.pg_proc p
     WHERE p.oid=v_function_oid;

    IF NOT FOUND
       OR v_owner IS DISTINCT FROM 'postgres'::pg_catalog.regrole::oid
       OR v_security_definer IS DISTINCT FROM true
       OR v_function_settings IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] THEN
      RAISE EXCEPTION 'Refusing reconciliation: owner, SECURITY DEFINER, or search_path mismatch for %', v_function.signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon',v_function_oid,'EXECUTE') IS DISTINCT FROM false
       OR pg_catalog.has_function_privilege('authenticated',v_function_oid,'EXECUTE') IS DISTINCT FROM v_function.authenticated_execute
       OR pg_catalog.has_function_privilege('service_role',v_function_oid,'EXECUTE') IS DISTINCT FROM v_function.service_role_execute THEN
      RAISE EXCEPTION 'Refusing reconciliation: EXECUTE grant mismatch for %', v_function.signature;
    END IF;
  END LOOP;

  INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
  VALUES ('20261031140000', NULL, 'security_definer_search_path_hardening');
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Expected exactly one history row insert, got %', v_inserted;
  END IF;

  SELECT count(*)
    INTO v_history_count
    FROM supabase_migrations.schema_migrations h
   WHERE h.version='20261031140000'
     AND h.name='security_definer_search_path_hardening'
     AND h.statements IS NULL;

  IF v_history_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'History row verification failed; expected exactly one correctly named record, got %', v_history_count;
  END IF;
END;
$reconcile$;

COMMIT;
