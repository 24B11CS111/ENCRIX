-- Persist owner CSV imports atomically, with tenant-scoped deduplication and retry safety.
-- Apply after the lead, assignment, distribution, notification, profile and audit migrations.

-- Non-unique indexes accelerate same-tenant phone and retry-marker lookups. They
-- deliberately do not assume legacy phone data is unique or rewrite old records.
CREATE INDEX IF NOT EXISTS idx_leads_org_normalized_phone
  ON public.leads (organization_id, (regexp_replace(phone, '\D', '', 'g')));

CREATE INDEX IF NOT EXISTS idx_leads_csv_import_marker
  ON public.leads (organization_id, (metadata->>'csv_import_id'), (metadata->>'csv_import_row_index'))
  WHERE metadata ? 'csv_import_id';

-- RLS currently grants authenticated owners direct lead writes. This trigger
-- makes every insert or phone/tenant change share the RPC lock and duplicate
-- check, closing races from any other authorized table writer as well.
CREATE OR REPLACE FUNCTION public.guard_org_lead_phone_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_digits text;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.phone IS NULL THEN
    RETURN NEW;
  END IF;
  v_digits := regexp_replace(NEW.phone, '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND v_digits = regexp_replace(OLD.phone, '\D', '', 'g') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.organization_id = NEW.organization_id
       AND l.id IS DISTINCT FROM NEW.id
       AND regexp_replace(l.phone, '\D', '', 'g') = v_digits
  ) THEN
    RAISE EXCEPTION 'lead phone already exists in this organization' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_org_lead_phone_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_org_lead_phone_write() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.leads'::regclass
       AND tgname = 'trg_lead_org_phone_dedup_guard'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_lead_org_phone_dedup_guard
      BEFORE INSERT OR UPDATE OF organization_id, phone ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.guard_org_lead_phone_write()';
  END IF;
END;
$$;

-- Manual creation and CSV import must take the same tenant lock before checking
-- normalized phones. Keep this lock expression identical in both RPCs.
CREATE OR REPLACE FUNCTION public.create_owner_lead(
  p_organization_id uuid,
  p_actor_profile_id uuid,
  p_name text,
  p_phone text,
  p_email text DEFAULT NULL,
  p_source text DEFAULT 'Direct',
  p_priority text DEFAULT 'MEDIUM',
  p_notes text DEFAULT NULL,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor record;
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_digits text;
  v_lead public.leads%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_actor_profile_id IS NULL
     OR p_name IS NULL OR btrim(p_name) = '' OR length(p_name) > 255
     OR v_phone = '' OR length(v_phone) > 50
     OR v_phone !~ '^\+?[0-9[:space:]().-]+$'
     OR length(regexp_replace(v_phone, '\D', '', 'g')) < 10
     OR (p_email IS NOT NULL AND length(p_email) > 255)
     OR (p_source IS NOT NULL AND length(p_source) > 100)
     OR (p_notes IS NOT NULL AND length(p_notes) > 10000)
     OR COALESCE(p_priority, 'MEDIUM') NOT IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT') THEN
    RAISE EXCEPTION 'invalid lead fields' USING ERRCODE = '22023';
  END IF;

  SELECT id, organization_id, role, status, full_name
    INTO v_actor FROM public.profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND OR v_actor.organization_id <> p_organization_id
     OR v_actor.role NOT IN ('OWNER', 'ADMIN') OR v_actor.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'owner authorization failed' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  IF EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.organization_id = p_organization_id
       AND regexp_replace(l.phone, '\D', '', 'g') = v_digits
  ) THEN
    RAISE EXCEPTION 'lead phone already exists in this organization' USING ERRCODE = '23505';
  END IF;

  IF p_assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_assigned_to
       AND p.organization_id = p_organization_id
       AND p.role = 'TELECALLER'
       AND p.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'assigned telecaller is not active in this organization' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.leads (
    organization_id, lead_code, name, phone, email, source, status, priority,
    assigned_to, notes, calls_count, created_at, updated_at
  ) VALUES (
    p_organization_id,
    'LV-' || substr(replace(extensions.uuid_generate_v4()::text, '-', ''), 1, 16),
    btrim(p_name), v_phone, NULLIF(lower(btrim(p_email)), ''),
    COALESCE(NULLIF(btrim(p_source), ''), 'Direct'),
    CASE WHEN p_assigned_to IS NULL THEN 'NEW' ELSE 'ASSIGNED' END,
    COALESCE(p_priority, 'MEDIUM'), p_assigned_to, p_notes, 0, now(), now()
  ) RETURNING * INTO v_lead;

  INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (p_organization_id, p_actor_profile_id, 'LEAD_CREATED', 'lead', v_lead.id,
          jsonb_build_object('leadCode', v_lead.lead_code, 'name', v_lead.name), now());

  RETURN jsonb_build_object('lead', to_jsonb(v_lead));
END;
$$;

REVOKE ALL ON FUNCTION public.create_owner_lead(uuid, uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_lead(uuid, uuid, text, text, text, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.import_owner_leads(
  p_organization_id uuid,
  p_actor_profile_id uuid,
  p_import_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor record;
  v_config record;
  v_row jsonb;
  v_row_index integer;
  v_seen_row_indexes integer[] := ARRAY[]::integer[];
  v_name text;
  v_phone text;
  v_digits text;
  v_lead_id uuid;
  v_replay_phone text;
  v_replay_assignee uuid;
  v_replay_reason text;
  v_lead_code text;
  v_mode text := 'MANUAL';
  v_enabled boolean := false;
  v_max_workload integer;
  v_cursor integer := 0;
  v_eligible uuid[] := ARRAY[]::uuid[];
  v_candidate uuid;
  v_candidate_index integer;
  v_attempt integer;
  v_open_count integer;
  v_new_count integer := 0;
  v_inserted_count integer := 0;
  v_assigned_count integer := 0;
  v_unassigned_count integer := 0;
  v_duplicates integer[] := ARRAY[]::integer[];
  v_unassigned_ids uuid[] := ARRAY[]::uuid[];
  v_assignments jsonb := '{}'::jsonb;
  v_assignment_total integer;
  v_assignment record;
  v_inserted_assigned_count integer := 0;
  v_inserted_unassigned_count integer := 0;
  v_inserted_assignments jsonb := '{}'::jsonb;
  v_reason text;
  v_auto boolean := false;
  v_has_telecaller boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_actor_profile_id IS NULL OR p_import_id IS NULL
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'invalid import arguments' USING ERRCODE = '22023';
  END IF;

  SELECT id, organization_id, role, status, full_name
    INTO v_actor
    FROM public.profiles
   WHERE id = p_actor_profile_id;
  IF NOT FOUND OR v_actor.organization_id <> p_organization_id
     OR v_actor.role NOT IN ('OWNER', 'ADMIN') OR v_actor.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'owner authorization failed' USING ERRCODE = '42501';
  END IF;

  -- Serializes imports for one tenant so phone checks and retry markers cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  SELECT mode, enabled_for_import, max_workload, eligible_telecaller_ids, round_robin_index
    INTO v_config
    FROM public.distribution_configs
   WHERE organization_id = p_organization_id
   FOR UPDATE;
  IF FOUND THEN
    v_mode := v_config.mode;
    v_enabled := v_config.enabled_for_import;
    v_max_workload := v_config.max_workload;
    v_cursor := v_config.round_robin_index;
  END IF;
  v_auto := v_enabled AND v_mode IN ('ROUND_ROBIN', 'WORKLOAD_BALANCED');

  IF v_auto THEN
    IF jsonb_typeof(v_config.eligible_telecaller_ids) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'distribution eligibility configuration is invalid' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(p.id ORDER BY p.id), ARRAY[]::uuid[])
      INTO v_eligible
      FROM public.profiles p
     WHERE p.organization_id = p_organization_id
       AND p.role = 'TELECALLER'
       AND p.status = 'ACTIVE'
       AND (
         COALESCE(jsonb_array_length(v_config.eligible_telecaller_ids), 0) = 0
         OR v_config.eligible_telecaller_ids @> to_jsonb(p.id::text)
       );
    IF cardinality(v_eligible) = 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.organization_id = p_organization_id AND p.role = 'TELECALLER'
      ) INTO v_has_telecaller;
      IF NOT v_has_telecaller THEN
        v_reason := 'EMPTY_TEAM';
      ELSIF jsonb_array_length(v_config.eligible_telecaller_ids) > 0 THEN
        v_reason := 'EXCLUDED_POOL';
      ELSE
        v_reason := 'NO_ELIGIBLE_TELECALLERS';
      END IF;
    END IF;
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_row) <> 'object'
       OR COALESCE(v_row->>'row_index', '') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'invalid row index' USING ERRCODE = '22023';
    END IF;
    v_row_index := (v_row->>'row_index')::integer;
    IF v_row_index > 5000 OR v_row_index = ANY(v_seen_row_indexes) THEN
      RAISE EXCEPTION 'row indexes must be unique and between 1 and 5000' USING ERRCODE = '22023';
    END IF;
    v_seen_row_indexes := array_append(v_seen_row_indexes, v_row_index);
    IF jsonb_typeof(v_row->'name') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'phone') IS DISTINCT FROM 'string'
       OR (v_row ? 'email' AND jsonb_typeof(v_row->'email') NOT IN ('string', 'null'))
       OR (v_row ? 'source' AND jsonb_typeof(v_row->'source') NOT IN ('string', 'null'))
       OR (v_row ? 'notes' AND jsonb_typeof(v_row->'notes') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION 'lead name and phone must be strings' USING ERRCODE = '22023';
    END IF;
    v_name := btrim(v_row->>'name');
    v_phone := btrim(v_row->>'phone');
    v_digits := regexp_replace(v_phone, '\D', '', 'g');
    IF v_row_index < 1 OR v_name IS NULL OR v_name = '' OR length(v_name) > 255
       OR length(v_phone) > 50 OR length(v_digits) < 10
       OR v_phone !~ '^\+?[0-9[:space:]().-]+$'
       OR length(COALESCE(v_row->>'email', '')) > 255
       OR length(COALESCE(v_row->>'source', '')) > 100
       OR length(COALESCE(v_row->>'notes', '')) > 10000
       OR COALESCE(v_row->>'priority', 'MEDIUM') NOT IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT') THEN
      RAISE EXCEPTION 'invalid import row %', v_row_index USING ERRCODE = '22023';
    END IF;

    -- A repeated request with the same import and row is an idempotent success.
    SELECT l.id, l.phone, l.assigned_to, l.unassigned_reason
      INTO v_lead_id, v_replay_phone, v_replay_assignee, v_replay_reason
      FROM public.leads l
     WHERE l.organization_id = p_organization_id
       AND l.metadata->>'csv_import_id' = p_import_id::text
       AND l.metadata->>'csv_import_row_index' = v_row_index::text
     LIMIT 1;
    IF FOUND THEN
      IF regexp_replace(v_replay_phone, '\D', '', 'g') <> v_digits THEN
        RAISE EXCEPTION 'import identity conflicts with an existing row' USING ERRCODE = '23505';
      END IF;
      v_new_count := v_new_count + 1;
      IF v_auto THEN
        IF v_replay_assignee IS NOT NULL THEN
          v_assigned_count := v_assigned_count + 1;
          v_assignments := jsonb_set(v_assignments, ARRAY[v_replay_assignee::text],
            to_jsonb(COALESCE((v_assignments->>v_replay_assignee::text)::integer, 0) + 1), true);
        ELSE
          v_unassigned_count := v_unassigned_count + 1;
          v_unassigned_ids := array_append(v_unassigned_ids, v_lead_id);
          v_reason := COALESCE(v_reason, v_replay_reason);
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.organization_id = p_organization_id
         AND regexp_replace(l.phone, '\D', '', 'g') = v_digits
    ) THEN
      v_duplicates := array_append(v_duplicates, v_row_index);
      CONTINUE;
    END IF;

    v_candidate := NULL;
    IF v_auto AND cardinality(v_eligible) > 0 THEN
      IF v_mode = 'ROUND_ROBIN' THEN
        FOR v_attempt IN 0..cardinality(v_eligible)-1 LOOP
          v_candidate_index := ((v_cursor + v_attempt) % cardinality(v_eligible)) + 1;
          IF v_max_workload IS NULL THEN
            v_candidate := v_eligible[v_candidate_index];
            v_cursor := v_candidate_index % cardinality(v_eligible);
            EXIT;
          END IF;
          SELECT count(*) INTO v_open_count FROM public.leads l
           WHERE l.organization_id = p_organization_id
             AND l.assigned_to = v_eligible[v_candidate_index]
             AND l.status IN ('NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP');
          IF v_open_count < v_max_workload THEN
            v_candidate := v_eligible[v_candidate_index];
            v_cursor := v_candidate_index % cardinality(v_eligible);
            EXIT;
          END IF;
        END LOOP;
      ELSE
        SELECT p.id INTO v_candidate
          FROM unnest(v_eligible) AS candidate(id)
          JOIN public.profiles p ON p.id = candidate.id
         WHERE v_max_workload IS NULL OR (
           SELECT count(*) FROM public.leads l
            WHERE l.organization_id = p_organization_id
              AND l.assigned_to = p.id
              AND l.status IN ('NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP')
         ) < v_max_workload
         ORDER BY (
           SELECT count(*) FROM public.leads l
            WHERE l.organization_id = p_organization_id
              AND l.assigned_to = p.id
              AND l.status IN ('NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP')
         ), p.id
         LIMIT 1;
      END IF;
    END IF;

    IF v_auto AND v_candidate IS NULL THEN
      v_reason := COALESCE(v_reason, 'CAPACITY_REACHED');
    END IF;
    v_lead_code := 'CSV-' || substr(replace(p_import_id::text, '-', ''), 1, 12) || '-' || v_row_index::text;
    INSERT INTO public.leads (
      organization_id, lead_code, name, phone, email, source, status, priority,
      assigned_to, notes, metadata, unassigned_reason, created_at, updated_at
    ) VALUES (
      p_organization_id, v_lead_code, v_name, v_phone,
      NULLIF(lower(btrim(v_row->>'email')), ''),
      COALESCE(NULLIF(v_row->>'source', ''), 'CSV Import'),
      CASE WHEN v_candidate IS NULL THEN 'NEW' ELSE 'ASSIGNED' END,
      COALESCE(v_row->>'priority', 'MEDIUM'), v_candidate,
      COALESCE(NULLIF(v_row->>'notes', ''), 'Imported via CSV/XLSX wizard'),
      jsonb_build_object('csv_import_id', p_import_id::text, 'csv_import_row_index', v_row_index),
      CASE WHEN v_candidate IS NULL THEN COALESCE(v_reason, 'MANUAL_UNASSIGNED') ELSE NULL END,
      now(), now()
    ) RETURNING id INTO v_lead_id;
    v_new_count := v_new_count + 1;
    v_inserted_count := v_inserted_count + 1;

    IF v_candidate IS NOT NULL THEN
      INSERT INTO public.lead_assignments (organization_id, lead_id, user_id, assigned_by, assigned_at, mode)
      VALUES (p_organization_id, v_lead_id, v_candidate, p_actor_profile_id, now(), v_mode);
      v_assigned_count := v_assigned_count + 1;
      v_inserted_assigned_count := v_inserted_assigned_count + 1;
      v_assignments := jsonb_set(v_assignments, ARRAY[v_candidate::text],
        to_jsonb(COALESCE((v_assignments->>v_candidate::text)::integer, 0) + 1), true);
      v_inserted_assignments := jsonb_set(v_inserted_assignments, ARRAY[v_candidate::text],
        to_jsonb(COALESCE((v_inserted_assignments->>v_candidate::text)::integer, 0) + 1), true);
    ELSIF v_auto THEN
      v_unassigned_count := v_unassigned_count + 1;
      v_inserted_unassigned_count := v_inserted_unassigned_count + 1;
      v_unassigned_ids := array_append(v_unassigned_ids, v_lead_id);
    END IF;
  END LOOP;

  IF v_mode = 'ROUND_ROBIN' AND v_auto AND cardinality(v_eligible) > 0 THEN
    UPDATE public.distribution_configs SET round_robin_index = v_cursor, updated_at = now()
     WHERE organization_id = p_organization_id;
  END IF;

  IF v_inserted_count > 0 THEN
    INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, metadata, created_at)
    VALUES (p_organization_id, p_actor_profile_id, 'LEAD_CREATED', 'lead',
            jsonb_build_object('count', v_inserted_count, 'source', 'CSV_IMPORT'), now());
  END IF;

  IF v_auto AND v_inserted_count > 0 THEN
    FOR v_assignment IN SELECT key AS user_id, value::integer AS lead_count
                          FROM jsonb_each_text(v_inserted_assignments)
    LOOP
      INSERT INTO public.notifications (organization_id, user_id, type, title, message, link, created_at)
      VALUES (
        p_organization_id,
        v_assignment.user_id::uuid,
        'LEAD_ASSIGNED',
        CASE WHEN v_mode = 'WORKLOAD_BALANCED' THEN 'Workload-Balanced Lead Assignment' ELSE 'Round-Robin Lead Assignment' END,
        format('%s leads assigned to your queue via automated %s distribution.',
          v_assignment.lead_count, replace(lower(v_mode), '_', ' ')),
        '/telecaller/leads', now()
      );
    END LOOP;
    INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, metadata, created_at)
    VALUES (
      p_organization_id, p_actor_profile_id,
      CASE WHEN v_inserted_assigned_count > 0 THEN 'LEAD_ASSIGNED' ELSE 'ASSIGNMENT_FAILED' END,
      'lead',
      jsonb_build_object(
        'mode', v_mode,
        'requestedCount', v_inserted_count,
        'assignedCount', v_inserted_assigned_count,
        'unassignedCount', v_inserted_unassigned_count,
        'unassignedReason', CASE WHEN v_inserted_unassigned_count > 0 THEN v_reason ELSE NULL END,
        'telecallerDistribution', v_inserted_assignments
      ), now()
    );
  END IF;

  IF v_auto THEN
    v_assignment_total := v_assigned_count + v_unassigned_count;
    RETURN jsonb_build_object(
      'imported_count', v_new_count,
      'duplicate_row_indexes', to_jsonb(v_duplicates),
      'distribution', jsonb_build_object(
        'success', v_assigned_count > 0,
        'mode', v_mode,
        'total_requested', v_assignment_total,
        'assigned_count', v_assigned_count,
        'unassigned_count', v_unassigned_count,
        'assignments', v_assignments,
        'unassigned_lead_ids', to_jsonb(v_unassigned_ids),
        'unassigned_reason', v_reason
      )
    );
  END IF;
  RETURN jsonb_build_object('imported_count', v_new_count,
                            'duplicate_row_indexes', to_jsonb(v_duplicates),
                            'distribution', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.import_owner_leads(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_owner_leads(uuid, uuid, uuid, jsonb) TO service_role;
