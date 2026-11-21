-- ENCRIX: Replace raw lead-row Realtime events with metadata-only refresh cursors.
-- Apply only after the frontend and custom-session refresh consumer are ready.
-- This migration intentionally does not change any production environment.

-- PostgreSQL 15+ is required for publication column lists. Supabase local is
-- configured for PostgreSQL 17; fail before making schema changes on older
-- servers.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'lead refresh signal publication column lists require PostgreSQL 15 or newer';
  END IF;
END;
$$;

DO $$
DECLARE
  v_signal_table oid;
  v_relkind "char";
  v_relowner oid;
  v_column_count integer;
  v_id_attnum smallint;
  v_org_attnum smallint;
  v_recipient_attnum smallint;
  v_revision_attnum smallint;
  v_updated_attnum smallint;
  v_owner oid := (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = current_user);
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publication is required for lead refresh signals';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
      AND puballtables
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publishes all tables; review and explicitly scope the publication before this migration';
  END IF;

  v_signal_table := pg_catalog.to_regclass('public.lead_refresh_signals');
  IF v_signal_table IS NOT NULL THEN
    SELECT c.relkind, c.relowner
      INTO v_relkind, v_relowner
      FROM pg_catalog.pg_class AS c
     WHERE c.oid = v_signal_table;
    IF v_relkind <> 'r' OR v_relowner <> v_owner THEN
      RAISE EXCEPTION 'existing public.lead_refresh_signals is not a migration-owned ordinary table';
    END IF;

    SELECT count(*) INTO v_column_count
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = v_signal_table
       AND a.attnum > 0
       AND NOT a.attisdropped;
    IF v_column_count <> 5
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = v_signal_table AND a.attname = 'id'
            AND a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
            AND a.attnotnull AND a.attidentity = 'a'
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = v_signal_table AND a.attname = 'organization_id'
            AND a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
            AND a.attnotnull
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = v_signal_table AND a.attname = 'recipient_profile_id'
            AND a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
            AND NOT a.attnotnull
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = v_signal_table AND a.attname = 'revision'
            AND a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
            AND a.attnotnull
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = v_signal_table AND a.attname = 'updated_at'
            AND a.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype
            AND a.attnotnull
       ) THEN
      RAISE EXCEPTION 'existing public.lead_refresh_signals has an incompatible column definition';
    END IF;

    SELECT a.attnum::smallint INTO v_id_attnum
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = v_signal_table AND a.attname = 'id' AND NOT a.attisdropped;
    SELECT a.attnum::smallint INTO v_org_attnum
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = v_signal_table AND a.attname = 'organization_id' AND NOT a.attisdropped;
    SELECT a.attnum::smallint INTO v_recipient_attnum
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = v_signal_table AND a.attname = 'recipient_profile_id' AND NOT a.attisdropped;
    SELECT a.attnum::smallint INTO v_revision_attnum
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = v_signal_table AND a.attname = 'revision' AND NOT a.attisdropped;
    SELECT a.attnum::smallint INTO v_updated_attnum
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = v_signal_table AND a.attname = 'updated_at' AND NOT a.attisdropped;

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = v_signal_table AND c.contype = 'p'
         AND c.conkey = ARRAY[v_id_attnum]::smallint[]
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = v_signal_table AND c.contype = 'f'
         AND c.conkey = ARRAY[v_org_attnum]::smallint[]
         AND c.confrelid = 'public.organizations'::pg_catalog.regclass
         AND c.confdeltype = 'c'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = v_signal_table AND c.contype = 'f'
         AND c.conkey = ARRAY[v_recipient_attnum]::smallint[]
         AND c.confrelid = 'public.profiles'::pg_catalog.regclass
         AND c.confdeltype = 'c'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = v_signal_table AND c.contype = 'c'
         AND pg_catalog.strpos(
           pg_catalog.pg_get_expr(c.conbin, c.conrelid),
           'revision > 0'
         ) > 0
    ) THEN
      RAISE EXCEPTION 'existing public.lead_refresh_signals has incompatible primary, foreign, or check constraints';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy AS p
       WHERE p.polrelid = v_signal_table
         AND p.polname NOT IN (
           'lead_refresh_owner_admin_read_org',
           'lead_refresh_telecaller_read_self'
         )
    ) THEN
      RAISE EXCEPTION 'existing public.lead_refresh_signals has an unexpected RLS policy';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
       WHERE p.oid IN (
         pg_catalog.to_regprocedure('public.bump_lead_refresh_signal(uuid,uuid)'),
         pg_catalog.to_regprocedure('public.emit_lead_refresh_signal()')
       )
         AND p.proowner <> v_owner
    ) THEN
      RAISE EXCEPTION 'an internal lead refresh function exists with an unexpected owner';
    END IF;
  END IF;
END;
$$;

-- One row per organization audience and one per telecaller audience. A cursor
-- avoids an ever-growing event log and needs no scheduler or cleanup job.
-- No lead identifiers or customer data are stored in this table.
CREATE TABLE IF NOT EXISTS public.lead_refresh_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_profile_id uuid
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

-- A NULL recipient represents the single organization-level refresh cursor.
-- A non-NULL recipient represents one active telecaller profile's cursor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_refresh_org_cursor
  ON public.lead_refresh_signals (organization_id)
  WHERE recipient_profile_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_refresh_profile_cursor
  ON public.lead_refresh_signals (organization_id, recipient_profile_id)
  WHERE recipient_profile_id IS NOT NULL;

COMMENT ON TABLE public.lead_refresh_signals IS
  'Metadata-only refresh cursors; never stores lead rows or customer contact data.';
COMMENT ON COLUMN public.lead_refresh_signals.recipient_profile_id IS
  'NULL for organization owner/admin refresh; otherwise the addressed telecaller profiles.id.';
COMMENT ON COLUMN public.lead_refresh_signals.revision IS
  'Monotonic refresh cursor for the organization or recipient profile scope.';

ALTER TABLE public.lead_refresh_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_refresh_signals REPLICA IDENTITY DEFAULT;

DROP POLICY IF EXISTS lead_refresh_owner_admin_read_org
  ON public.lead_refresh_signals;
CREATE POLICY lead_refresh_owner_admin_read_org
  ON public.lead_refresh_signals
  FOR SELECT
  TO authenticated
  USING (
    recipient_profile_id IS NULL
    AND organization_id = public.get_auth_org_id()
    AND public.get_auth_role() IN ('OWNER', 'ADMIN')
    AND public.is_active_authenticated_profile()
  );

DROP POLICY IF EXISTS lead_refresh_telecaller_read_self
  ON public.lead_refresh_signals;
CREATE POLICY lead_refresh_telecaller_read_self
  ON public.lead_refresh_signals
  FOR SELECT
  TO authenticated
  USING (
    recipient_profile_id IS NOT NULL
    AND organization_id = public.get_auth_org_id()
    AND public.get_auth_role() = 'TELECALLER'
    AND public.is_active_authenticated_profile()
    AND recipient_profile_id = (
      SELECT (public.get_auth_profile()).id
    )
  );

-- Default ACLs in staging are broad. Revoke all direct access, then grant only
-- the SELECT needed by authenticated Realtime clients and the server poller.
REVOKE ALL PRIVILEGES ON TABLE public.lead_refresh_signals
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE SELECT (id, organization_id, recipient_profile_id, revision, updated_at),
       INSERT (id, organization_id, recipient_profile_id, revision, updated_at),
       UPDATE (id, organization_id, recipient_profile_id, revision, updated_at),
       REFERENCES (id, organization_id, recipient_profile_id, revision, updated_at)
  ON TABLE public.lead_refresh_signals
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lead_refresh_signals TO authenticated, service_role;

-- The identity sequence is used only by the table owner / trigger path.
-- Discover its actual name rather than assuming PostgreSQL's generated name.
DO $$
DECLARE
  v_sequence_oid oid;
  v_sequence_schema name;
  v_sequence_name name;
BEGIN
  v_sequence_oid := pg_catalog.to_regclass(
    pg_catalog.pg_get_serial_sequence(
      'public.lead_refresh_signals',
      'id'
    )
  );
  IF v_sequence_oid IS NULL THEN
    RAISE EXCEPTION 'lead_refresh_signals identity sequence was not created';
  END IF;

  SELECT n.nspname, c.relname
    INTO v_sequence_schema, v_sequence_name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE c.oid = v_sequence_oid;

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC, anon, authenticated, service_role',
    v_sequence_schema,
    v_sequence_name
  );
END;
$$;

-- Internal helper: advance one organization or telecaller cursor. The helper
-- is callable only by the trigger function; it cannot be used as a client RPC.
CREATE OR REPLACE FUNCTION public.bump_lead_refresh_signal(
  p_organization_id uuid,
  p_recipient_profile_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;

  IF p_recipient_profile_id IS NULL THEN
    INSERT INTO public.lead_refresh_signals AS current_cursor (
      organization_id,
      recipient_profile_id,
      revision,
      updated_at
    ) VALUES (
      p_organization_id,
      NULL,
      1,
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT (organization_id)
      WHERE recipient_profile_id IS NULL
    DO UPDATE SET
      revision = current_cursor.revision + 1,
      updated_at = pg_catalog.clock_timestamp();
    RETURN;
  END IF;

  -- Do not create a recipient cursor for a profile outside this organization
  -- or for a non-telecaller. Active status is enforced again by read policies.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS recipient
    WHERE recipient.id = p_recipient_profile_id
      AND recipient.organization_id = p_organization_id
      AND recipient.role = 'TELECALLER'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.lead_refresh_signals AS current_cursor (
    organization_id,
    recipient_profile_id,
    revision,
    updated_at
  ) VALUES (
    p_organization_id,
    p_recipient_profile_id,
    1,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (organization_id, recipient_profile_id)
    WHERE recipient_profile_id IS NOT NULL
  DO UPDATE SET
    revision = current_cursor.revision + 1,
    updated_at = pg_catalog.clock_timestamp();
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_lead_refresh_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.bump_lead_refresh_signal(NEW.organization_id, NULL);
    IF NEW.assigned_to IS NOT NULL THEN
      PERFORM public.bump_lead_refresh_signal(NEW.organization_id, NEW.assigned_to);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.bump_lead_refresh_signal(OLD.organization_id, NULL);
    IF OLD.assigned_to IS NOT NULL THEN
      PERFORM public.bump_lead_refresh_signal(OLD.organization_id, OLD.assigned_to);
    END IF;
    RETURN OLD;
  END IF;

  -- Every update refreshes the organization scope. If a lead moves tenants,
  -- both organizations are advanced so the old tenant can remove stale UI.
  PERFORM public.bump_lead_refresh_signal(NEW.organization_id, NULL);
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    PERFORM public.bump_lead_refresh_signal(OLD.organization_id, NULL);
  END IF;

  -- Advance the previous assignee first. On reassignment, this tells the old
  -- telecaller to remove the lead. The new assignee gets a separate cursor.
  IF OLD.assigned_to IS NOT NULL THEN
    PERFORM public.bump_lead_refresh_signal(OLD.organization_id, OLD.assigned_to);
  END IF;
  IF NEW.assigned_to IS NOT NULL
     AND (OLD.assigned_to, OLD.organization_id)
         IS DISTINCT FROM (NEW.assigned_to, NEW.organization_id) THEN
    PERFORM public.bump_lead_refresh_signal(NEW.organization_id, NEW.assigned_to);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION
  public.bump_lead_refresh_signal(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION
  public.emit_lead_refresh_signal()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_trigger_function oid :=
    'public.emit_lead_refresh_signal()'::pg_catalog.regprocedure::oid;
  v_existing_function oid;
BEGIN
  SELECT t.tgfoid
    INTO v_existing_function
    FROM pg_catalog.pg_trigger AS t
   WHERE t.tgrelid = 'public.leads'::regclass
     AND t.tgname = 'trg_leads_emit_sanitized_refresh_signal'
     AND NOT t.tgisinternal;

  IF v_existing_function IS NOT NULL
     AND v_existing_function <> v_trigger_function THEN
    RAISE EXCEPTION 'trigger name is already used by a different function';
  END IF;

  IF v_existing_function IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER trg_leads_emit_sanitized_refresh_signal ON public.leads';
  END IF;

  EXECUTE 'CREATE TRIGGER trg_leads_emit_sanitized_refresh_signal
    AFTER INSERT OR UPDATE OR DELETE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.emit_lead_refresh_signal()';
END;
$$;

-- Replace raw lead-row publication with the metadata-only cursor relation.
-- The table has no contact columns; the explicit publication column list is
-- defense in depth and makes the Realtime contract auditable.
-- Rollback intentionally removes this table from the publication and does NOT
-- restore public.leads. Publication-wide actions and unrelated memberships
-- remain unchanged, avoiding reintroduction of raw customer data.
-- Manual rollback (review first; do not restore the old leads publication):
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.lead_refresh_signals;
-- DROP TRIGGER IF EXISTS trg_leads_emit_sanitized_refresh_signal ON public.leads;
-- DROP FUNCTION IF EXISTS public.emit_lead_refresh_signal();
-- DROP FUNCTION IF EXISTS public.bump_lead_refresh_signal(uuid, uuid);
-- DROP TABLE IF EXISTS public.lead_refresh_signals;
-- This removes only objects introduced here and leaves every unrelated
-- publication membership and publication action unchanged. Raw public.leads
-- stays unpublished deliberately; any decision to restore it requires a
-- separate security review and a reviewed column-level publication policy.
DO $$
DECLARE
  v_signal_columns name[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'leads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.leads';
  END IF;

  SELECT p.attnames INTO v_signal_columns
    FROM pg_catalog.pg_publication_tables AS p
   WHERE p.pubname = 'supabase_realtime'
     AND p.schemaname = 'public'
     AND p.tablename = 'lead_refresh_signals';

  IF FOUND THEN
    IF v_signal_columns IS DISTINCT FROM ARRAY[
      'id'::name, 'organization_id'::name, 'recipient_profile_id'::name,
      'revision'::name, 'updated_at'::name
    ] THEN
      RAISE EXCEPTION 'lead_refresh_signals is already published with an incompatible column list';
    END IF;
  ELSE
    EXECUTE 'ALTER PUBLICATION supabase_realtime
      ADD TABLE public.lead_refresh_signals
        (id, organization_id, recipient_profile_id, revision, updated_at)';
  END IF;
END;
$$;
