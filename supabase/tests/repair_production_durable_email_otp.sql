-- Forward repair for the confirmed missing effects of
-- 20261031150000_durable_email_otp_attempts.sql.
--
-- MANUAL SAFETY: Run only in the independently verified ENCRIX production
-- SQL Editor after backup and review. This script does not alter migration
-- history. It is intentionally fail-closed: it requires the 080000 base table
-- contract, RLS and service-only policy; both durable columns, the target
-- index name and all three exact RPC signatures must be absent. It creates
-- functions (never CREATE OR REPLACE) so it cannot overwrite unseen code.
-- A successful run is one-shot; verify state before any subsequent attempt.

BEGIN;

-- Serialize schema changes and avoid racing OTP sends while adding columns.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.email_otps IN ACCESS EXCLUSIVE MODE;

DO $otp_repair_preflight$
DECLARE
  v_table_oid OID := pg_catalog.to_regclass('public.email_otps');
  v_column RECORD;
  v_expected RECORD;
  v_id_default_oid OID;
  v_base_column_count INTEGER;
  v_purpose_attnum SMALLINT;
  v_purpose_constraint_count INTEGER;
  v_purpose_constraint_definition TEXT;
BEGIN
  IF v_table_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = v_table_oid AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: public.email_otps is absent or is not an ordinary table';
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
    INTO v_base_column_count
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = v_table_oid AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_base_column_count <> 9 THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: public.email_otps must have exactly the nine migration-080000 base columns';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: required Supabase API roles are missing';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: executing role cannot create the required RPCs in public';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: executing role lacks public schema USAGE';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: service_role lacks public schema USAGE required to call the RPCs';
  END IF;
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: migration history table is absent; confirm migration state first';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
             WHERE version = '20261031150000') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: migration 150000 is already recorded; inspect state instead of repairing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE c.oid = v_table_oid
      AND (r.rolname = current_user OR r.rolsuper)
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: executing role is not the table owner or a superuser';
  END IF;

  -- Require the exact base-column type/nullability/default contract from 080000.
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('id',         'uuid',                       'uuid'),
      ('email',      'character varying(255)',     NULL),
      ('purpose',    'character varying(50)',      NULL),
      ('otp_hash',   'character varying(255)',     NULL),
      ('attempts',   'integer',                    '0'),
      ('resend_after','timestamp with time zone',  NULL),
      ('expires_at', 'timestamp with time zone',   NULL),
      ('used',       'boolean',                    'false'),
      ('created_at', 'timestamp with time zone',   'now()')
    ) AS expected(column_name, formatted_type, expected_default)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
           a.attnotnull AS is_not_null,
           CASE WHEN d.oid IS NULL THEN NULL
                ELSE pg_catalog.lower(pg_catalog.regexp_replace(
                       pg_catalog.pg_get_expr(d.adbin, d.adrelid), '\s+', '', 'g'))
           END AS normalized_default
      INTO v_column
      FROM pg_catalog.pg_attribute a
      LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = v_table_oid
       AND a.attname = v_expected.column_name
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: required 080000 column is absent: %', v_expected.column_name;
    END IF;
    IF v_column.formatted_type IS DISTINCT FROM v_expected.formatted_type
       OR v_column.is_not_null IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: incompatible base column definition: %', v_expected.column_name;
    END IF;
    IF v_expected.expected_default IS NULL THEN
      IF v_column.normalized_default IS NOT NULL THEN
        RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: unexpected default on base column: %', v_expected.column_name;
      END IF;
    ELSIF v_expected.column_name <> 'id'
       AND v_column.normalized_default IS DISTINCT FROM v_expected.expected_default THEN
      RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: incompatible default on base column: %', v_expected.column_name;
    END IF;
  END LOOP;

  -- The id default must resolve to the uuid-ossp function installed in extensions.
  SELECT d.refobjid
    INTO v_id_default_oid
    FROM pg_catalog.pg_attrdef ad
    JOIN pg_catalog.pg_depend d
      ON d.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass
     AND d.objid = ad.oid
     AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   WHERE ad.adrelid = v_table_oid
     AND ad.adnum = (SELECT attnum FROM pg_catalog.pg_attribute
                     WHERE attrelid = v_table_oid AND attname = 'id' AND NOT attisdropped)
     AND d.refobjid = pg_catalog.to_regprocedure('extensions.uuid_generate_v4()');
  IF v_id_default_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace en ON en.oid = e.extnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = v_id_default_oid
      JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
       JOIN pg_catalog.pg_depend ed
         ON ed.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        AND ed.objid = p.oid
        AND ed.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
        AND ed.refobjid = e.oid
        AND ed.deptype = 'e'
     WHERE e.extname = 'uuid-ossp'
       AND en.nspname = 'extensions'
       AND pn.nspname = 'extensions'
       AND p.proname = 'uuid_generate_v4'
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: email_otps.id default does not resolve to extensions.uuid_generate_v4() from uuid-ossp';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(current_user, 'extensions', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(current_user, v_id_default_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: executing role cannot use the email_otps UUID default';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = v_table_oid AND c.contype = 'p'
      AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
                            WHERE a.attrelid = v_table_oid AND a.attname = 'id'
                              AND NOT a.attisdropped)]::smallint[]
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: email_otps primary key is not exactly id';
  END IF;

  -- Compare the complete PostgreSQL 17 deparsed expression, not token presence.
  SELECT a.attnum INTO v_purpose_attnum
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = v_table_oid AND a.attname = 'purpose'
     AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT pg_catalog.count(*)::INTEGER,
         pg_catalog.min(pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_constraintdef(c.oid, false), '[[:space:]]+', '', 'g'
         )))
    INTO v_purpose_constraint_count, v_purpose_constraint_definition
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = v_table_oid AND c.contype = 'c'
     AND v_purpose_attnum = ANY (c.conkey);
  IF v_purpose_constraint_count <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = v_table_oid AND c.contype = 'c'
          AND v_purpose_attnum = ANY (c.conkey)
          AND c.conkey = ARRAY[v_purpose_attnum]::SMALLINT[]
          AND pg_catalog.cardinality(c.conkey) = 1
          AND c.convalidated AND NOT c.connoinherit
     )
     OR v_purpose_constraint_definition IS DISTINCT FROM
         'check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))' THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: email_otps purpose constraint differs from migration 080000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                 WHERE c.oid = v_table_oid AND c.relrowsecurity
                   AND (NOT c.relforcerowsecurity OR EXISTS (
                     SELECT 1 FROM pg_catalog.pg_roles r
                     WHERE r.rolname = current_user AND r.rolbypassrls
                   ))) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: email_otps RLS is not enabled';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = 'email_otps') <> 1
     OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'email_otps'
       AND p.policyname = 'Service role only access to email_otps'
       AND p.permissive = 'PERMISSIVE' AND p.cmd = 'ALL'
       AND p.roles = ARRAY['service_role']::NAME[]
       AND p.qual = 'true' AND p.with_check = 'true'
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: expected 080000 service_role-only email_otps policy is absent or differs';
  END IF;

  -- Supplied evidence confirms the columns and issue RPC are absent. Stop on
  -- any partial state instead of guessing whether to reconcile it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid = v_table_oid AND attname IN ('ticket_id','verified_at')
               AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: durable OTP column exists; review partial state before repair';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'email_otps_ticket_id_uidx') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: target index name is already occupied';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('issue_email_otp_ticket',
                        'complete_email_otp_verification',
                        'cancel_email_otp_ticket')
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: a target OTP RPC name is already occupied; inspect before reconciliation';
  END IF;

  IF NOT pg_catalog.has_table_privilege(current_user, v_table_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege(current_user, v_table_oid, 'INSERT')
     OR NOT pg_catalog.has_table_privilege(current_user, v_table_oid, 'UPDATE') THEN
    RAISE EXCEPTION 'OTP_REPAIR_BLOCKED: executing role lacks required table privileges for SECURITY DEFINER RPCs';
  END IF;
END;
$otp_repair_preflight$;

ALTER TABLE public.email_otps
  ADD COLUMN ticket_id UUID,
  ADD COLUMN verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX email_otps_ticket_id_uidx
  ON public.email_otps (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE FUNCTION public.issue_email_otp_ticket(
  p_ticket_id UUID,
  p_email TEXT,
  p_purpose TEXT,
  p_otp_hash TEXT,
  p_resend_after TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_resend_after TIMESTAMPTZ;
  v_send_count INTEGER;
BEGIN
  IF p_ticket_id IS NULL
     OR v_email IS NULL OR v_email = ''
     OR p_purpose IS NULL OR p_purpose NOT IN ('LOGIN', 'INVITATION')
     OR p_otp_hash IS NULL OR p_otp_hash !~ '^[a-f0-9]{64}$'
     OR p_resend_after IS NULL
     OR p_expires_at IS NULL
     OR p_resend_after <= v_now
     OR p_expires_at <= v_now
     OR p_resend_after > p_expires_at
     OR p_expires_at > v_now + INTERVAL '15 minutes' THEN
    RAISE EXCEPTION 'invalid_email_otp_ticket' USING ERRCODE = '22023';
  END IF;

  -- Serialize issuance per normalized email and purpose across API instances.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_email || ':' || p_purpose, 0)
  );

  SELECT e.resend_after
    INTO v_resend_after
    FROM public.email_otps AS e
   WHERE e.email = v_email
     AND e.purpose = p_purpose
     AND e.used = FALSE
   ORDER BY e.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_resend_after > v_now THEN
    RETURN pg_catalog.jsonb_build_object(
      'issued', FALSE,
      'reason', 'cooldown',
      'resend_after', v_resend_after,
      'cooldown_seconds', GREATEST(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', v_resend_after - v_now))::INTEGER
      )
    );
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
    INTO v_send_count
    FROM public.email_otps AS e
   WHERE e.email = v_email
     AND e.purpose = p_purpose
     AND e.created_at >= v_now - INTERVAL '15 minutes';

  IF v_send_count >= 5 THEN
    RETURN pg_catalog.jsonb_build_object('issued', FALSE, 'reason', 'rate_limited');
  END IF;

  -- Resending invalidates every older ticket before the new row is created.
  UPDATE public.email_otps AS e
     SET used = TRUE
   WHERE e.email = v_email
     AND e.purpose = p_purpose
     AND e.used = FALSE;

  INSERT INTO public.email_otps (
    ticket_id, email, purpose, otp_hash, attempts, resend_after, expires_at,
    used, created_at, verified_at
  ) VALUES (
    p_ticket_id, v_email, p_purpose, p_otp_hash, 0, p_resend_after, p_expires_at,
    FALSE, v_now, NULL
  );

  RETURN pg_catalog.jsonb_build_object('issued', TRUE, 'resend_after', p_resend_after);
END;
$$;

CREATE FUNCTION public.complete_email_otp_verification(
  p_ticket_id UUID,
  p_email TEXT,
  p_purpose TEXT,
  p_is_valid BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_row public.email_otps%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_attempts INTEGER;
BEGIN
  IF p_ticket_id IS NULL
     OR v_email IS NULL OR v_email = ''
     OR p_purpose IS NULL OR p_purpose NOT IN ('LOGIN', 'INVITATION')
     OR p_is_valid IS NULL THEN
    RAISE EXCEPTION 'invalid_email_otp_verification' USING ERRCODE = '22023';
  END IF;

  SELECT e.*
    INTO v_row
    FROM public.email_otps AS e
   WHERE e.ticket_id = p_ticket_id
     AND e.email = v_email
     AND e.purpose = p_purpose
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'unavailable');
  END IF;

  IF v_row.expires_at <= v_now THEN
    UPDATE public.email_otps AS e SET used = TRUE
     WHERE e.id = v_row.id AND e.used = FALSE;
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'expired');
  END IF;

  IF v_row.used THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'consumed');
  END IF;

  IF v_row.attempts >= 5 THEN
    UPDATE public.email_otps AS e SET used = TRUE
     WHERE e.id = v_row.id AND e.used = FALSE;
    RETURN pg_catalog.jsonb_build_object(
      'verified', FALSE, 'reason', 'locked', 'attempts', v_row.attempts
    );
  END IF;

  IF NOT p_is_valid THEN
    v_attempts := v_row.attempts + 1;
    UPDATE public.email_otps AS e
       SET attempts = v_attempts,
           used = (v_attempts >= 5)
     WHERE e.id = v_row.id;
    RETURN pg_catalog.jsonb_build_object(
      'verified', FALSE,
      'reason', CASE WHEN v_attempts >= 5 THEN 'locked' ELSE 'invalid' END,
      'attempts', v_attempts
    );
  END IF;

  UPDATE public.email_otps AS e
     SET used = TRUE, verified_at = v_now
   WHERE e.id = v_row.id AND e.used = FALSE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'consumed');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'verified', TRUE, 'attempts', v_row.attempts, 'verified_at', v_now
  );
END;
$$;

CREATE FUNCTION public.cancel_email_otp_ticket(
  p_ticket_id UUID,
  p_email TEXT,
  p_purpose TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_ticket_id IS NULL
     OR p_email IS NULL OR pg_catalog.lower(pg_catalog.btrim(p_email)) = ''
     OR p_purpose IS NULL OR p_purpose NOT IN ('LOGIN', 'INVITATION') THEN
    RAISE EXCEPTION 'invalid_email_otp_ticket' USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_otps AS e
     SET used = TRUE
   WHERE e.ticket_id = p_ticket_id
     AND e.email = pg_catalog.lower(pg_catalog.btrim(p_email))
     AND e.purpose = p_purpose
     AND e.used = FALSE;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_email_otp_ticket(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_email_otp_verification(UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_email_otp_ticket(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_email_otp_ticket(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_email_otp_verification(UUID, TEXT, TEXT, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_email_otp_ticket(UUID, TEXT, TEXT)
  TO service_role;

DO $otp_repair_postcheck$
DECLARE
  v_proc OID;
  v_expected RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'public.email_otps'::pg_catalog.regclass
                   AND attname = 'ticket_id' AND atttypid = 'uuid'::pg_catalog.regtype
                   AND NOT attnotnull AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                    WHERE attrelid = 'public.email_otps'::pg_catalog.regclass
                      AND attname = 'verified_at' AND atttypid = 'timestamp with time zone'::pg_catalog.regtype
                      AND NOT attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'OTP_REPAIR_FAILED: durable columns do not match migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.email_otps'::pg_catalog.regclass
      AND a.attname IN ('ticket_id','verified_at') AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_FAILED: durable OTP columns unexpectedly have defaults';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index x ON x.indexrelid = i.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'public' AND i.relname = 'email_otps_ticket_id_uidx'
      AND x.indrelid = 'public.email_otps'::pg_catalog.regclass
      AND x.indisunique AND x.indisvalid AND x.indisready
      AND x.indnkeyatts = 1 AND x.indnatts = 1
      AND x.indkey[0] = (SELECT a.attnum FROM pg_catalog.pg_attribute a
                         WHERE a.attrelid = x.indrelid AND a.attname = 'ticket_id'
                           AND NOT a.attisdropped)
      AND pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.pg_get_expr(x.indpred, x.indrelid), '\s+', '', 'g'
          )) = '(ticket_idisnotnull)'
  ) THEN
    RAISE EXCEPTION 'OTP_REPAIR_FAILED: ticket index contract mismatch';
  END IF;

  FOR v_expected IN
    SELECT * FROM (VALUES
      ('public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)'::pg_catalog.regprocedure, 'jsonb'::pg_catalog.regtype, ARRAY['p_ticket_id','p_email','p_purpose','p_otp_hash','p_resend_after','p_expires_at']::text[]),
      ('public.complete_email_otp_verification(uuid,text,text,boolean)'::pg_catalog.regprocedure, 'jsonb'::pg_catalog.regtype, ARRAY['p_ticket_id','p_email','p_purpose','p_is_valid']::text[]),
      ('public.cancel_email_otp_ticket(uuid,text,text)'::pg_catalog.regprocedure, 'boolean'::pg_catalog.regtype, ARRAY['p_ticket_id','p_email','p_purpose']::text[])
    ) AS e(proc_oid, return_type, argument_names)
  LOOP
    v_proc := v_expected.proc_oid;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_proc AND p.prosecdef
        AND p.prorettype = v_expected.return_type
        AND p.proargnames = v_expected.argument_names
        AND p.prolang = (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'plpgsql')
        AND p.provolatile = 'v' AND NOT p.proisstrict AND p.proparallel = 'u'
        AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantee = 'service_role'::pg_catalog.regrole
            AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable
        )
    ) THEN
      RAISE EXCEPTION 'OTP_REPAIR_FAILED: RPC security/permission contract mismatch for %', v_proc::pg_catalog.regprocedure;
    END IF;
  END LOOP;
END;
$otp_repair_postcheck$;

COMMIT;
