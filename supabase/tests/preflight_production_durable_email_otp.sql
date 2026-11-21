-- Read-only preflight for the guarded durable email OTP repair.
-- Run in the independently confirmed ENCRIX production SQL Editor.
-- Catalog metadata and fixed aggregate checks only; no OTP/customer rows or secrets.
-- The project reference cannot be proven from PostgreSQL catalogs: confirm it in
-- the SQL Editor UI and compare it to Vercel's configured Supabase project.

-- 1. Identity evidence. Project identity remains UNKNOWN until manually confirmed.
SELECT 'DATABASE_IDENTITY' AS check_name,
       'UNKNOWN' AS result,
       current_database() AS database_name,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS server_version,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       'Confirm the selected SQL Editor project reference matches Vercel production' AS required_action;

-- 2. Exact base columns from migration 080000. The id default is checked by
-- function dependency below because PostgreSQL may deparse it qualified/unqualified.
WITH expected(column_name, formatted_type, not_null, expected_default) AS (
  VALUES
    ('id', 'uuid', TRUE, 'UUID_FUNCTION'::text),
    ('email', 'character varying(255)', TRUE, NULL::text),
    ('purpose', 'character varying(50)', TRUE, NULL::text),
    ('otp_hash', 'character varying(255)', TRUE, NULL::text),
    ('attempts', 'integer', TRUE, '0'::text),
    ('resend_after', 'timestamp with time zone', TRUE, NULL::text),
    ('expires_at', 'timestamp with time zone', TRUE, NULL::text),
    ('used', 'boolean', TRUE, 'false'::text),
    ('created_at', 'timestamp with time zone', TRUE, 'now()'::text)
), actual AS (
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
         a.attnotnull AS not_null,
         CASE WHEN d.oid IS NULL THEN NULL ELSE
           pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.pg_get_expr(d.adbin, d.adrelid), '[[:space:]]+', '', 'g'
           )) END AS normalized_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = pg_catalog.to_regclass('public.email_otps')
     AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT 'BASE_COLUMN:' || e.column_name AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'MISSING'
            WHEN a.column_name IS NULL THEN 'MISSING'
            WHEN a.formatted_type IS DISTINCT FROM e.formatted_type
              OR a.not_null IS DISTINCT FROM e.not_null THEN 'MISMATCH'
            WHEN e.column_name = 'id' AND a.normalized_default IS NULL THEN 'MISMATCH'
            WHEN e.column_name <> 'id' AND e.expected_default IS NULL
              AND a.normalized_default IS NOT NULL THEN 'MISMATCH'
            WHEN e.column_name <> 'id' AND e.expected_default IS NOT NULL
              AND a.normalized_default IS DISTINCT FROM e.expected_default THEN 'MISMATCH'
            ELSE 'PASS' END AS result,
       e.formatted_type AS expected_type,
       a.formatted_type AS actual_type,
       e.not_null AS expected_not_null,
       a.not_null AS actual_not_null,
       e.expected_default,
       a.normalized_default AS actual_default
  FROM expected e LEFT JOIN actual a USING (column_name)
 ORDER BY e.column_name;

-- 3. Require exactly nine visible base columns; unexpected extras are a mismatch.
SELECT 'BASE_COLUMN_COUNT' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'MISSING'
            WHEN count(a.attname) = 9 THEN 'PASS' ELSE 'MISMATCH' END AS result,
       count(a.attname)::integer AS actual_count,
       9 AS expected_count
  FROM (SELECT pg_catalog.to_regclass('public.email_otps') AS relid) r
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = r.relid AND a.attnum > 0 AND NOT a.attisdropped;

-- 4. The id default must resolve through catalog dependencies to the exact
-- extensions.uuid_generate_v4() function owned by uuid-ossp in extensions.
SELECT 'UUID_DEFAULT_RESOLUTION' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN d.oid IS NULL THEN 'MISMATCH'
            WHEN p.oid = pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')
             AND pn.nspname = 'extensions' AND e.extname = 'uuid-ossp'
             AND en.nspname = 'extensions' THEN 'PASS'
            ELSE 'MISMATCH' END AS result,
       CASE WHEN d.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_expr(d.adbin, d.adrelid) END AS actual_default,
       pn.nspname AS function_schema,
       p.proname AS function_name,
       e.extname AS extension_name,
       en.nspname AS extension_schema
  FROM (SELECT pg_catalog.to_regclass('public.email_otps') AS relid) r
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = r.relid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass AND dep.objid = d.oid
   AND dep.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = dep.refobjid
  LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_depend ed
    ON ed.classid = 'pg_catalog.pg_extension'::pg_catalog.regclass
   AND ed.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   AND ed.refobjid = p.oid AND ed.deptype = 'e'
  LEFT JOIN pg_catalog.pg_extension e ON e.oid = ed.objid
  LEFT JOIN pg_catalog.pg_namespace en ON en.oid = e.extnamespace;

-- 5. The id primary key must contain only id.
SELECT 'ID_PRIMARY_KEY' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN EXISTS (
              SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conrelid = pg_catalog.to_regclass('public.email_otps')
                AND c.contype = 'p'
                AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attname = 'id' AND NOT a.attisdropped)]::smallint[]
                AND pg_catalog.cardinality(c.conkey) = 1
            ) THEN 'PASS' ELSE 'MISMATCH' END AS result;

-- 6. Exact purpose CHECK emitted by PostgreSQL 17 for migration 080000's
-- purpose IN ('LOGIN','REGISTER','INVITATION') expression. Full normalized
-- definition equality is required; token/substr matching is intentionally absent.
WITH purpose_att AS (
  SELECT a.attnum
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = pg_catalog.to_regclass('public.email_otps')
     AND a.attname = 'purpose' AND a.attnum > 0 AND NOT a.attisdropped
), purpose_constraint_rows AS (
  SELECT c.oid, c.convalidated, c.connoinherit,
         c.conkey,
         pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_constraintdef(c.oid, false), '[[:space:]]+', '', 'g'
         )) AS normalized_definition
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = pg_catalog.to_regclass('public.email_otps')
     AND c.contype = 'c'
     AND (SELECT attnum FROM purpose_att) = ANY (c.conkey)
)
SELECT 'PURPOSE_CONSTRAINT' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN (SELECT count(*) FROM purpose_constraint_rows) = 0 THEN 'MISSING'
            WHEN (SELECT count(*) FROM purpose_constraint_rows) <> 1 THEN 'MISMATCH'
            WHEN EXISTS (SELECT 1 FROM purpose_constraint_rows c
              WHERE NOT c.convalidated OR c.connoinherit
                 OR c.conkey <> ARRAY[(SELECT attnum FROM purpose_att)]::smallint[]
                 OR pg_catalog.cardinality(c.conkey) <> 1
                 OR c.normalized_definition IS DISTINCT FROM
                    'check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))')
              THEN 'MISMATCH'
            ELSE 'PASS' END AS result,
       'check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))' AS expected_normalized_definition,
       (SELECT normalized_definition FROM purpose_constraint_rows LIMIT 1) AS actual_normalized_definition;

-- 7. RLS and sole service-role policy from migration 080000.
WITH relation AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_catalog.pg_class c
   WHERE c.oid = pg_catalog.to_regclass('public.email_otps')
), policies AS (
  SELECT p.* FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'email_otps'
)
SELECT 'EMAIL_OTPS_RLS_POLICY' AS check_name,
       CASE WHEN NOT EXISTS (SELECT 1 FROM relation) THEN 'MISSING'
            WHEN NOT (SELECT relrowsecurity FROM relation) THEN 'MISMATCH'
            WHEN (SELECT count(*) FROM policies) <> 1 THEN 'MISMATCH'
            WHEN NOT EXISTS (SELECT 1 FROM policies p
              WHERE p.policyname = 'Service role only access to email_otps'
                AND p.permissive = 'PERMISSIVE' AND p.cmd = 'ALL'
                AND p.roles = ARRAY['service_role']::name[]
                AND p.qual = 'true' AND p.with_check = 'true') THEN 'MISMATCH'
            ELSE 'PASS' END AS result,
       (SELECT relrowsecurity FROM relation) AS rls_enabled,
       (SELECT relforcerowsecurity FROM relation) AS rls_forced,
       (SELECT count(*) FROM policies)::integer AS policy_count;

-- 8. Required Supabase roles and public-schema usage for service_role.
SELECT 'ROLE:' || r.rolname AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname = r.rolname)
            THEN 'PASS' ELSE 'MISSING' END AS result
  FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) r(rolname)
 ORDER BY r.rolname;

SELECT 'SERVICE_ROLE_PUBLIC_USAGE' AS check_name,
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN 'UNKNOWN'
            WHEN pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE') THEN 'PASS'
            ELSE 'MISMATCH' END AS result;

-- 9. DDL and table privileges required by the repair executor and SECURITY DEFINER owner.
SELECT 'EXECUTOR_PUBLIC_CREATE' AS check_name,
       CASE WHEN pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') THEN 'PASS'
            ELSE 'MISMATCH' END AS result,
       current_user AS executor;

SELECT 'EXECUTOR_PUBLIC_USAGE' AS check_name,
       CASE WHEN pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') THEN 'PASS'
            ELSE 'MISMATCH' END AS result;

SELECT 'EXECUTOR_TABLE_OWNERSHIP' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
              WHERE c.oid = pg_catalog.to_regclass('public.email_otps')
                AND (r.rolname = current_user OR r.rolsuper)) THEN 'PASS'
            ELSE 'MISMATCH' END AS result;

SELECT 'EXECUTOR_EMAIL_OTPS_PRIVILEGES' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('public.email_otps'), 'SELECT')
             AND pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('public.email_otps'), 'INSERT')
             AND pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('public.email_otps'), 'UPDATE') THEN 'PASS'
            ELSE 'MISMATCH' END AS result;

SELECT 'EXECUTOR_UUID_DEFAULT_PRIVILEGES' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN NOT pg_catalog.has_schema_privilege(current_user, 'extensions', 'USAGE') THEN 'MISMATCH'
            WHEN NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_attrdef d
              JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
              JOIN pg_catalog.pg_depend dep ON dep.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass
                AND dep.objid=d.oid AND dep.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
              WHERE d.adrelid='public.email_otps'::pg_catalog.regclass AND a.attname='id'
                AND dep.refobjid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')
                AND pg_catalog.has_function_privilege(current_user, dep.refobjid, 'EXECUTE')
            ) THEN 'MISMATCH' ELSE 'PASS' END AS result;

-- 10. Migration history structure and target-version absence. The history
-- lookup is a fixed literal SELECT through query_to_xml so a missing relation
-- is reported rather than aborting the script; no user-supplied SQL is executed.
WITH history AS (
  SELECT c.oid AS relid,
         CASE WHEN c.oid IS NULL THEN FALSE
              ELSE c.relkind = 'r'
               AND (SELECT count(*) FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) = 3
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid
                 AND a.attname = 'version' AND a.atttypid = 'text'::pg_catalog.regtype
                 AND a.attnotnull AND NOT a.attisdropped)
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid
                 AND a.attname = 'statements' AND a.atttypid = 'text[]'::pg_catalog.regtype
                 AND NOT a.attnotnull AND NOT a.attisdropped)
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid
                 AND a.attname = 'name' AND a.atttypid = 'text'::pg_catalog.regtype
                 AND NOT a.attnotnull AND NOT a.attisdropped)
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid
                 AND k.contype = 'p'
                 AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'version' AND NOT a.attisdropped)]::smallint[]
                 AND pg_catalog.cardinality(k.conkey) = 1)
          END AS schema_ok
    FROM (SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS oid) r
    LEFT JOIN pg_catalog.pg_class c ON c.oid = r.oid
), details AS (
  SELECT h.relid, h.schema_ok,
         CASE WHEN h.relid IS NULL OR NOT h.schema_ok
                    OR NOT pg_catalog.has_table_privilege(current_user, h.relid, 'SELECT') THEN NULL
              ELSE (SELECT x.version_count
                      FROM XMLTABLE('/table/row'
                        PASSING pg_catalog.query_to_xml(
                          'SELECT count(*)::bigint AS version_count FROM supabase_migrations.schema_migrations WHERE version = ''20261031150000''',
                          FALSE, FALSE, '')
                        COLUMNS version_count bigint PATH 'version_count') AS x)
          END AS target_count
    FROM history h
)
SELECT 'MIGRATION_HISTORY_150000' AS check_name,
       CASE WHEN d.relid IS NULL THEN 'MISSING'
            WHEN NOT d.schema_ok THEN 'MISMATCH'
            WHEN NOT pg_catalog.has_table_privilege(current_user, d.relid, 'SELECT') THEN 'UNKNOWN'
            WHEN d.target_count = 0 THEN 'PASS'
            ELSE 'MISMATCH' END AS result,
       d.target_count AS recorded_count,
       '20261031150000 must be absent before repair' AS expected
  FROM details d;

SELECT 'MIGRATION_HISTORY_SCHEMA' AS check_name,
       CASE WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'MISSING'
            WHEN EXISTS (
              SELECT 1 FROM pg_catalog.pg_class t
              WHERE t.oid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
                AND t.relkind = 'r'
                AND (SELECT count(*) FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped) = 3
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attname='version'
                  AND a.atttypid='text'::pg_catalog.regtype AND a.attnotnull AND NOT a.attisdropped)
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attname='statements'
                  AND a.atttypid='text[]'::pg_catalog.regtype AND NOT a.attnotnull AND NOT a.attisdropped)
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attname='name'
                  AND a.atttypid='text'::pg_catalog.regtype AND NOT a.attnotnull AND NOT a.attisdropped)
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=t.oid AND c.contype='p'
                  AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid
                    AND a.attname='version' AND NOT a.attisdropped)]::smallint[] AND pg_catalog.cardinality(c.conkey)=1)
            ) THEN 'PASS' ELSE 'MISMATCH' END AS result;

-- 11. No partially present durable columns, named index, or RPC overloads.
SELECT 'DURABLE_COLUMNS_ABSENT' AS check_name,
       CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid=pg_catalog.to_regclass('public.email_otps')
                AND a.attname IN ('ticket_id','verified_at') AND a.attnum>0 AND NOT a.attisdropped)
              THEN 'MISMATCH' ELSE 'PASS' END AS result;

SELECT 'TARGET_INDEX_NAME_ABSENT' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                         WHERE n.nspname='public' AND c.relname='email_otps_ticket_id_uidx')
            THEN 'MISMATCH' ELSE 'PASS' END AS result;

SELECT 'TARGET_RPC_NAMES_ABSENT' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                         WHERE n.nspname='public' AND p.proname IN ('issue_email_otp_ticket',
                           'complete_email_otp_verification','cancel_email_otp_ticket'))
            THEN 'MISMATCH' ELSE 'PASS' END AS result;
