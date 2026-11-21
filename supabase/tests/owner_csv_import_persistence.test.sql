-- Run after 20261030120000_owner_csv_import_persistence.sql in a disposable local DB.
-- All fixtures and tested writes are rolled back. This file does not contact a remote DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_org uuid := extensions.uuid_generate_v4();
  v_other_org uuid := extensions.uuid_generate_v4();
  v_empty_org uuid := extensions.uuid_generate_v4();
  v_excluded_org uuid := extensions.uuid_generate_v4();
  v_inactive_org uuid := extensions.uuid_generate_v4();
  v_actor uuid := extensions.uuid_generate_v4();
  v_user uuid := extensions.uuid_generate_v4();
  v_tc1 uuid := extensions.uuid_generate_v4();
  v_tc2 uuid := extensions.uuid_generate_v4();
  v_inactive_tc uuid := extensions.uuid_generate_v4();
  v_telecaller uuid := extensions.uuid_generate_v4();
  v_disabled_tc uuid := extensions.uuid_generate_v4();
  v_disabled_owner uuid := extensions.uuid_generate_v4();
  v_empty_owner uuid := extensions.uuid_generate_v4();
  v_excluded_owner uuid := extensions.uuid_generate_v4();
  v_inactive_owner uuid := extensions.uuid_generate_v4();
  v_import uuid := extensions.uuid_generate_v4();
  v_rr_one uuid := extensions.uuid_generate_v4();
  v_rr_two uuid := extensions.uuid_generate_v4();
  v_workload_import uuid := extensions.uuid_generate_v4();
  v_empty_import uuid := extensions.uuid_generate_v4();
  v_excluded_import uuid := extensions.uuid_generate_v4();
  v_inactive_import uuid := extensions.uuid_generate_v4();
  v_duplicate_marker uuid := extensions.uuid_generate_v4();
  v_rollback_marker uuid := extensions.uuid_generate_v4();
  v_manual_import uuid := extensions.uuid_generate_v4();
  v_result jsonb;
  v_assigned_manual jsonb;
  v_duplicate jsonb;
  v_retry jsonb;
  v_rr_order uuid[];
  v_first_assignee uuid;
  v_second_assignee uuid;
  v_phone text := '+91 98765 43210';
  v_rows jsonb;
  v_large_rows jsonb;
  v_count integer;
  v_activity_count integer;
  v_security_definer boolean;
  v_function_config text[];
BEGIN
  -- Effective function ACL: API roles cannot call either RPC; server role can.
  IF has_function_privilege('anon', 'public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'import RPC execute privileges are not service-role-only';
  END IF;
  IF has_function_privilege('anon', 'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'manual create RPC execute privileges are not service-role-only';
  END IF;
  SELECT prosecdef, proconfig INTO v_security_definer, v_function_config
    FROM pg_proc WHERE oid = 'public.import_owner_leads(uuid,uuid,uuid,jsonb)'::regprocedure;
  IF v_security_definer IS DISTINCT FROM TRUE OR
     NOT COALESCE(array_to_string(v_function_config, ';') LIKE '%search_path=pg_catalog, pg_temp%', FALSE) THEN
    RAISE EXCEPTION 'import RPC is missing SECURITY DEFINER or its restricted search_path';
  END IF;
  SELECT prosecdef, proconfig INTO v_security_definer, v_function_config
    FROM pg_proc WHERE oid = 'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)'::regprocedure;
  IF v_security_definer IS DISTINCT FROM TRUE OR
     NOT COALESCE(array_to_string(v_function_config, ';') LIKE '%search_path=pg_catalog, pg_temp%', FALSE) THEN
    RAISE EXCEPTION 'manual create RPC is missing SECURITY DEFINER or its restricted search_path';
  END IF;
  IF to_regclass('public.idx_leads_org_normalized_phone') IS NULL OR
     to_regclass('public.idx_leads_csv_import_marker') IS NULL THEN
    RAISE EXCEPTION 'CSV import lookup indexes are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.leads'::regclass
    AND tgname='trg_lead_org_phone_dedup_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'global concurrent phone guard trigger is missing';
  END IF;

  INSERT INTO public.organizations (id, name, slug, owner_id) VALUES
    (v_org, 'CSV Test', 'csv-test-' || v_org::text, v_user),
    (v_other_org, 'Other CSV Test', 'csv-other-' || v_other_org::text, extensions.uuid_generate_v4()),
    (v_empty_org, 'Empty Team Test', 'csv-empty-' || v_empty_org::text, v_empty_owner),
    (v_excluded_org, 'Excluded Pool Test', 'csv-excluded-' || v_excluded_org::text, v_excluded_owner),
    (v_inactive_org, 'Inactive Team Test', 'csv-inactive-' || v_inactive_org::text, v_inactive_owner);
  INSERT INTO public.profiles (id, user_id, organization_id, full_name, role, status) VALUES
    (v_actor, v_user, v_org, 'CSV Owner', 'OWNER', 'ACTIVE'),
    (v_tc1, extensions.uuid_generate_v4(), v_org, 'Caller One', 'TELECALLER', 'ACTIVE'),
    (v_tc2, extensions.uuid_generate_v4(), v_org, 'Caller Two', 'TELECALLER', 'ACTIVE'),
    (v_telecaller, extensions.uuid_generate_v4(), v_org, 'Not Owner', 'TELECALLER', 'ACTIVE'),
    (v_disabled_tc, extensions.uuid_generate_v4(), v_org, 'Disabled Caller', 'TELECALLER', 'DISABLED'),
    (v_disabled_owner, extensions.uuid_generate_v4(), v_org, 'Disabled Owner', 'OWNER', 'DISABLED'),
    (v_empty_owner, extensions.uuid_generate_v4(), v_empty_org, 'Empty Owner', 'OWNER', 'ACTIVE'),
    (v_excluded_owner, extensions.uuid_generate_v4(), v_excluded_org, 'Excluded Owner', 'OWNER', 'ACTIVE'),
    (v_inactive_owner, extensions.uuid_generate_v4(), v_inactive_org, 'Inactive Owner', 'OWNER', 'ACTIVE'),
    (v_inactive_tc, extensions.uuid_generate_v4(), v_inactive_org, 'Inactive Caller', 'TELECALLER', 'DISABLED');

  -- Missing/inactive/non-owner actors and cross-tenant organization claims reject.
  BEGIN
    PERFORM public.import_owner_leads(v_org, v_telecaller, extensions.uuid_generate_v4(), '[]'::jsonb);
    RAISE EXCEPTION 'telecaller unexpectedly imported leads';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.import_owner_leads(v_org, v_disabled_owner, extensions.uuid_generate_v4(), '[]'::jsonb);
    RAISE EXCEPTION 'inactive owner unexpectedly imported leads';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.import_owner_leads(v_other_org, v_actor, extensions.uuid_generate_v4(), '[]'::jsonb);
    RAISE EXCEPTION 'cross-tenant owner import unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_owner_lead(v_other_org, v_actor, 'Cross tenant', '919876500001');
    RAISE EXCEPTION 'cross-tenant manual create unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Manual owner creation and CSV import share the same normalized-phone lock/check.
  v_result := public.create_owner_lead(v_org, v_actor, 'Manual lead', '+91 90000 00001');
  IF v_result->'lead'->>'phone' <> '+91 90000 00001' THEN
    RAISE EXCEPTION 'manual lead RPC did not return its created lead';
  END IF;
  v_assigned_manual := public.create_owner_lead(v_org, v_actor, 'Manually assigned lead', '919000000002', NULL, 'Direct', 'MEDIUM', NULL, v_tc1);
  IF v_assigned_manual->'lead'->>'status' <> 'ASSIGNED' OR
     v_assigned_manual->'lead'->>'assigned_to' <> v_tc1::text THEN
    RAISE EXCEPTION 'manual assignment fields were not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE organization_id=v_org
    AND action='LEAD_CREATED' AND entity_id=(v_result->'lead'->>'id')::uuid
    AND metadata->>'leadCode' IS NOT NULL) THEN
    RAISE EXCEPTION 'manual lead creation audit entry is missing';
  END IF;
  v_duplicate := public.import_owner_leads(v_org, v_actor, extensions.uuid_generate_v4(),
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'Duplicate Manual', 'phone', '919000000001')));
  IF v_duplicate->'duplicate_row_indexes' <> '[1]'::jsonb THEN
    RAISE EXCEPTION 'CSV import did not report the duplicate manual lead phone';
  END IF;
  BEGIN
    PERFORM public.create_owner_lead(v_org, v_actor, 'Duplicate manual', '919000000001');
    RAISE EXCEPTION 'manual create did not detect existing CSV/manual phone';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.leads (organization_id, lead_code, name, phone, status, priority)
    VALUES (v_org, 'DIRECT-DUP-' || substr(v_org::text, 1, 8), 'Direct duplicate', '+91 (90000) 00001', 'NEW', 'MEDIUM');
    RAISE EXCEPTION 'direct table insert bypassed tenant phone guard';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A 5,001-row payload is rejected inside the RPC before any insert.
  SELECT jsonb_agg(jsonb_build_object('row_index', n, 'name', 'Large', 'phone', '919999900000' || lpad(n::text, 4, '0')))
    INTO v_large_rows FROM generate_series(1, 5001) n;
  BEGIN
    PERFORM public.import_owner_leads(v_org, v_actor, extensions.uuid_generate_v4(), v_large_rows);
    RAISE EXCEPTION 'RPC accepted more than 5,000 rows';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Duplicate row indexes are rejected atomically even if API validation is bypassed.
  v_duplicate_marker := extensions.uuid_generate_v4();
  BEGIN
    PERFORM public.import_owner_leads(v_org, v_actor, v_duplicate_marker, jsonb_build_array(
      jsonb_build_object('row_index', 2, 'name', 'One', 'phone', '919999900101'),
      jsonb_build_object('row_index', 2, 'name', 'Two', 'phone', '919999900102')));
    RAISE EXCEPTION 'RPC accepted duplicate row indexes';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = v_org AND metadata->>'csv_import_id' = v_duplicate_marker::text) THEN
    RAISE EXCEPTION 'duplicate row-index failure did not roll back its earlier row';
  END IF;

  -- First import persists; exact retry is idempotent and does not duplicate data.
  v_rows := jsonb_build_array(jsonb_build_object(
    'row_index', 1, 'name', 'CSV Lead', 'phone', v_phone,
    'email', 'lead@example.test', 'source', 'CSV', 'priority', 'HIGH', 'notes', 'Test'
  ));
  v_result := public.import_owner_leads(v_org, v_actor, v_import, v_rows);
  IF (v_result->>'imported_count')::integer <> 1 THEN RAISE EXCEPTION 'first import did not report one lead'; END IF;
  IF (SELECT count(*) FROM public.leads WHERE organization_id = v_org AND metadata->>'csv_import_id' = v_import::text) <> 1 THEN
    RAISE EXCEPTION 'first import was not persisted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE organization_id=v_org AND action='LEAD_CREATED'
    AND metadata->>'source'='CSV_IMPORT' AND metadata->>'count'='1') THEN
    RAISE EXCEPTION 'CSV import audit entry is missing';
  END IF;
  v_retry := public.import_owner_leads(v_org, v_actor, v_import, v_rows);
  IF (v_retry->>'imported_count')::integer <> 1 OR
     (SELECT count(*) FROM public.leads WHERE organization_id = v_org AND metadata->>'csv_import_id' = v_import::text) <> 1 THEN
    RAISE EXCEPTION 'retry was not idempotent';
  END IF;
  IF v_retry::text LIKE '%' || regexp_replace(v_phone, '\s', '', 'g') || '%' THEN
    RAISE EXCEPTION 'RPC result exposed a phone number';
  END IF;

  -- Existing organization phone is duplicate; a reused marker with a new phone is a conflict.
  v_duplicate := public.import_owner_leads(v_org, v_actor, extensions.uuid_generate_v4(),
    jsonb_build_array(jsonb_build_object('row_index', 7, 'name', 'Duplicate', 'phone', '+919876543210')));
  IF v_duplicate->'duplicate_row_indexes' <> '[7]'::jsonb THEN RAISE EXCEPTION 'existing phone was not duplicate'; END IF;
  BEGIN
    PERFORM public.import_owner_leads(v_org, v_actor, v_import,
      jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'Changed', 'phone', '919876500099')));
    RAISE EXCEPTION 'same marker with different phone unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- An invalid later row rolls back the earlier valid insert and audit side effects.
  v_rollback_marker := extensions.uuid_generate_v4();
  SELECT count(*) INTO v_activity_count FROM public.activity_logs WHERE organization_id = v_org;
  BEGIN
    PERFORM public.import_owner_leads(v_org, v_actor, v_rollback_marker, jsonb_build_array(
      jsonb_build_object('row_index', 1, 'name', 'Will roll back', 'phone', '919999900201'),
      jsonb_build_object('row_index', 2, 'name', '', 'phone', '919999900202')));
    RAISE EXCEPTION 'later invalid row unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = v_org AND metadata->>'csv_import_id' = v_rollback_marker::text) THEN
    RAISE EXCEPTION 'later-row failure left a partial import';
  END IF;
  IF (SELECT count(*) FROM public.activity_logs WHERE organization_id = v_org) <> v_activity_count THEN
    RAISE EXCEPTION 'later-row failure left a partial activity audit';
  END IF;

  -- Round robin follows sorted profile IDs and advances its persisted cursor after each call.
  SELECT array_agg(id ORDER BY id) INTO v_rr_order FROM public.profiles
   WHERE organization_id = v_org AND role = 'TELECALLER' AND status = 'ACTIVE'
     AND id IN (v_tc1, v_tc2);
  INSERT INTO public.distribution_configs (organization_id, mode, enabled_for_import, max_workload, eligible_telecaller_ids, round_robin_index)
  VALUES (v_org, 'ROUND_ROBIN', TRUE, NULL, jsonb_build_array(v_tc1::text, v_tc2::text), 0)
  ON CONFLICT (organization_id) DO UPDATE SET mode='ROUND_ROBIN', enabled_for_import=TRUE,
    max_workload=NULL, eligible_telecaller_ids=jsonb_build_array(v_tc1::text, v_tc2::text), round_robin_index=0;
  v_result := public.import_owner_leads(v_org, v_actor, v_rr_one,
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'RR One', 'phone', '919999900301')));
  SELECT assigned_to INTO v_first_assignee FROM public.leads WHERE organization_id=v_org AND metadata->>'csv_import_id'=v_rr_one::text;
  IF v_first_assignee <> v_rr_order[1] OR
     (SELECT round_robin_index FROM public.distribution_configs WHERE organization_id=v_org) <> 1 THEN
    RAISE EXCEPTION 'round-robin first assignment or cursor is incorrect';
  END IF;
  v_result := public.import_owner_leads(v_org, v_actor, v_rr_two,
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'RR Two', 'phone', '919999900302')));
  SELECT assigned_to INTO v_second_assignee FROM public.leads WHERE organization_id=v_org AND metadata->>'csv_import_id'=v_rr_two::text;
  IF v_second_assignee <> v_rr_order[2] OR
     (SELECT round_robin_index FROM public.distribution_configs WHERE organization_id=v_org) <> 0 THEN
    RAISE EXCEPTION 'round-robin did not rotate and persist its cursor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE organization_id=v_org AND user_id=v_first_assignee AND type='LEAD_ASSIGNED') OR
     NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE organization_id=v_org AND action='LEAD_ASSIGNED' AND metadata->>'mode'='ROUND_ROBIN') THEN
    RAISE EXCEPTION 'round-robin notification or audit entry is missing';
  END IF;

  -- Workload balancing selects the caller with fewer open leads and respects capacity.
  UPDATE public.leads SET status='CONVERTED' WHERE organization_id=v_org AND metadata->>'csv_import_id' IN (v_rr_one::text,v_rr_two::text);
  UPDATE public.leads SET status='CONVERTED'
   WHERE id=(v_assigned_manual->'lead'->>'id')::uuid;
  INSERT INTO public.leads (organization_id, lead_code, name, phone, status, priority, assigned_to)
  VALUES (v_org, 'CSV-PREFILL-' || substr(v_org::text,1,8), 'Existing workload', '919999900399', 'ASSIGNED', 'MEDIUM', v_rr_order[1]);
  INSERT INTO public.distribution_configs (organization_id, mode, enabled_for_import, max_workload, eligible_telecaller_ids, round_robin_index)
  VALUES (v_org, 'WORKLOAD_BALANCED', TRUE, 1, jsonb_build_array(v_tc1::text, v_tc2::text), 0)
  ON CONFLICT (organization_id) DO UPDATE SET mode='WORKLOAD_BALANCED', enabled_for_import=TRUE,
    max_workload=1, eligible_telecaller_ids=jsonb_build_array(v_tc1::text, v_tc2::text), round_robin_index=0;
  v_result := public.import_owner_leads(v_org, v_actor, v_workload_import, jsonb_build_array(
    jsonb_build_object('row_index', 1, 'name', 'Workload Fits', 'phone', '919999900401'),
    jsonb_build_object('row_index', 2, 'name', 'Overflow', 'phone', '919999900402')));
  IF (v_result->'distribution'->>'assigned_count')::integer <> 1 OR
     (v_result->'distribution'->>'unassigned_count')::integer <> 1 THEN
    RAISE EXCEPTION 'workload balancing/capacity result is incorrect: %', v_result;
  END IF;
  IF (SELECT assigned_to FROM public.leads WHERE organization_id=v_org AND metadata->>'csv_import_id'=v_workload_import::text AND metadata->>'csv_import_row_index'='1') <> v_rr_order[2] OR
     (SELECT unassigned_reason FROM public.leads WHERE organization_id=v_org AND metadata->>'csv_import_id'=v_workload_import::text AND metadata->>'csv_import_row_index'='2') <> 'CAPACITY_REACHED' THEN
    RAISE EXCEPTION 'workload assignment or capacity overflow reason is incorrect';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE organization_id=v_org AND user_id=v_rr_order[2] AND type='LEAD_ASSIGNED' AND title='Workload-Balanced Lead Assignment') THEN
    RAISE EXCEPTION 'workload-balanced assignment notification is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE organization_id=v_org AND action='LEAD_ASSIGNED' AND metadata->>'mode'='WORKLOAD_BALANCED' AND metadata->>'unassignedCount'='1') THEN
    RAISE EXCEPTION 'workload assignment audit record is missing';
  END IF;

  -- Disabled/manual import stays in the unassigned queue with its legacy reason.
  UPDATE public.distribution_configs SET mode='MANUAL', enabled_for_import=FALSE WHERE organization_id=v_org;
  v_result := public.import_owner_leads(v_org, v_actor, v_manual_import,
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'Manual queue', 'phone', '919999900501')));
  IF v_result->'distribution' <> 'null'::jsonb OR
     (SELECT unassigned_reason FROM public.leads WHERE organization_id=v_org AND metadata->>'csv_import_id'=v_manual_import::text) <> 'MANUAL_UNASSIGNED' THEN
    RAISE EXCEPTION 'manual import did not remain in the unassigned queue';
  END IF;

  -- No callers, excluded caller pool, and only inactive callers preserve distinct reasons.
  INSERT INTO public.distribution_configs (organization_id, mode, enabled_for_import, eligible_telecaller_ids)
  VALUES (v_empty_org, 'ROUND_ROBIN', TRUE, '[]'::jsonb),
         (v_excluded_org, 'ROUND_ROBIN', TRUE, jsonb_build_array(extensions.uuid_generate_v4()::text)),
         (v_inactive_org, 'ROUND_ROBIN', TRUE, '[]'::jsonb);
  INSERT INTO public.profiles (id, user_id, organization_id, full_name, role, status)
  VALUES (extensions.uuid_generate_v4(), extensions.uuid_generate_v4(), v_excluded_org, 'Excluded Caller', 'TELECALLER', 'ACTIVE');
  v_result := public.import_owner_leads(v_empty_org, v_empty_owner, v_empty_import,
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'Empty team', 'phone', '919999900601')));
  IF v_result->'distribution'->>'unassigned_reason' <> 'EMPTY_TEAM' THEN RAISE EXCEPTION 'empty-team reason is wrong'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE organization_id=v_empty_org AND action='ASSIGNMENT_FAILED'
    AND metadata->>'unassignedReason'='EMPTY_TEAM') THEN RAISE EXCEPTION 'empty-team assignment failure audit is missing'; END IF;
  v_result := public.import_owner_leads(v_excluded_org, v_excluded_owner, v_excluded_import,
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'Excluded pool', 'phone', '919999900602')));
  IF v_result->'distribution'->>'unassigned_reason' <> 'EXCLUDED_POOL' THEN RAISE EXCEPTION 'excluded-pool reason is wrong'; END IF;
  v_result := public.import_owner_leads(v_inactive_org, v_inactive_owner, v_inactive_import,
    jsonb_build_array(jsonb_build_object('row_index', 1, 'name', 'Inactive team', 'phone', '919999900603')));
  IF v_result->'distribution'->>'unassigned_reason' <> 'NO_ELIGIBLE_TELECALLERS' THEN RAISE EXCEPTION 'no-eligible-callers reason is wrong'; END IF;

  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id=v_other_org) THEN
    RAISE EXCEPTION 'tenant-A import wrote a lead to tenant B';
  END IF;
END;
$$;
ROLLBACK;
