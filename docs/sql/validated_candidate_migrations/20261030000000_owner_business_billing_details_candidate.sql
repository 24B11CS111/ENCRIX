BEGIN;
DO $index_definition_preflight$
DECLARE
  v_index_oid oid;
  v_relkind text;
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_access_method text;
  v_key_count integer;
  v_attribute_count integer;
  v_first_key smallint;
  v_expression text;
  v_predicate text;
  v_first_option integer;
  v_email_attnum smallint;
  v_owner_attnum smallint;
BEGIN
  SELECT a.attnum INTO v_email_attnum
    FROM pg_catalog.pg_attribute AS a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attname = 'email' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnum INTO v_owner_attnum
    FROM pg_catalog.pg_attribute AS a
   WHERE a.attrelid = 'public.organizations'::regclass
     AND a.attname = 'owner_id' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_email_attnum IS NULL OR v_owner_attnum IS NULL THEN
    RAISE EXCEPTION 'Required index source column is missing; refusing business-details migration';
  END IF;

  SELECT c.oid, c.relkind::text, i.indisunique, i.indisvalid, i.indisready,
         am.amname, i.indnkeyatts, i.indnatts, i.indkey[0],
         pg_catalog.pg_get_expr(i.indexprs, i.indrelid),
         pg_catalog.pg_get_expr(i.indpred, i.indrelid), i.indoption[0]
    INTO v_index_oid, v_relkind, v_unique, v_valid, v_ready,
         v_access_method, v_key_count, v_attribute_count, v_first_key,
         v_expression, v_predicate, v_first_option
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
    LEFT JOIN pg_catalog.pg_am AS am ON am.oid = c.relam
   WHERE n.nspname = 'public' AND c.relname = 'profiles_email_unique_lower';
  IF FOUND AND (
       v_relkind <> 'i' OR v_unique IS DISTINCT FROM TRUE
       OR v_valid IS DISTINCT FROM TRUE OR v_ready IS DISTINCT FROM TRUE
       OR v_access_method IS DISTINCT FROM 'btree'
       OR v_key_count IS DISTINCT FROM 1 OR v_attribute_count IS DISTINCT FROM 1
       OR v_first_key IS DISTINCT FROM 0
       OR lower(regexp_replace(COALESCE(v_expression, ''), '[[:space:]()]', '', 'g')) <> 'lowerbtrimemail::text'
       OR lower(regexp_replace(COALESCE(v_predicate, ''), '[[:space:]()]', '', 'g')) <> 'emailisnotnull'
       OR v_first_option IS DISTINCT FROM 0
  ) THEN
    RAISE EXCEPTION 'Existing profiles_email_unique_lower has the wrong type, uniqueness, validity, access method, key expression, predicate, or ordering; inspect manually';
  END IF;

  SELECT c.oid, c.relkind::text, i.indisunique, i.indisvalid, i.indisready,
         am.amname, i.indnkeyatts, i.indnatts, i.indkey[0],
         pg_catalog.pg_get_expr(i.indexprs, i.indrelid),
         pg_catalog.pg_get_expr(i.indpred, i.indrelid), i.indoption[0]
    INTO v_index_oid, v_relkind, v_unique, v_valid, v_ready,
         v_access_method, v_key_count, v_attribute_count, v_first_key,
         v_expression, v_predicate, v_first_option
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
    LEFT JOIN pg_catalog.pg_am AS am ON am.oid = c.relam
   WHERE n.nspname = 'public' AND c.relname = 'organizations_owner_id_unique';
  IF FOUND AND (
       v_relkind <> 'i' OR v_unique IS DISTINCT FROM TRUE
       OR v_valid IS DISTINCT FROM TRUE OR v_ready IS DISTINCT FROM TRUE
       OR v_access_method IS DISTINCT FROM 'btree'
       OR v_key_count IS DISTINCT FROM 1 OR v_attribute_count IS DISTINCT FROM 1
       OR v_first_key IS DISTINCT FROM v_owner_attnum
       OR v_expression IS NOT NULL OR v_predicate IS NOT NULL
       OR v_first_option IS DISTINCT FROM 0
  ) THEN
    RAISE EXCEPTION 'Existing organizations_owner_id_unique has the wrong type, uniqueness, validity, access method, key column, predicate, or ordering; inspect manually';
  END IF;
END;
$index_definition_preflight$;
-- Owner onboarding business contact fields. Billing remains disabled until
-- Razorpay test setup and this migration are verified in staging.
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_location VARCHAR(500),
    ADD COLUMN IF NOT EXISTS website_url TEXT;

ALTER TABLE public.pending_registrations
    ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_location VARCHAR(500),
    ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Enforce registration idempotency at the database boundary. The indexes are
-- additive; creation fails safely if staging has pre-existing duplicates.
-- Preflight before applying (resolve manually; do not delete customer records):
-- SELECT lower(btrim(email)) AS normalized_email, count(*) AS duplicate_groups
-- FROM public.profiles WHERE email IS NOT NULL
-- GROUP BY lower(btrim(email)) HAVING count(*) > 1;
-- SELECT owner_id, array_agg(id) AS organization_ids
-- FROM public.organizations WHERE owner_id IS NOT NULL
-- GROUP BY owner_id HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_lower
    ON public.profiles (LOWER(BTRIM(email)))
    WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_id_unique
    ON public.organizations (owner_id);

COMMIT;
