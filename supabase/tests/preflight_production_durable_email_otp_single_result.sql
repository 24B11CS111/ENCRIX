-- Single-result, read-only preflight for the narrowly scoped durable email OTP repair.
-- Run only in the independently verified ENCRIX production SQL Editor.
-- This statement reads catalogs and the migration-history version count only;
-- it never reads OTP/customer rows, secrets, or environment variables.
-- Confirm the selected Supabase project reference in the SQL Editor UI because
-- PostgreSQL catalogs do not expose the hosted project reference.

WITH
target AS (
  SELECT pg_catalog.to_regclass('public.email_otps') AS relid
),
expected_columns(column_name, formatted_type, not_null, expected_default) AS (
  VALUES
    ('id',          'uuid',                       TRUE, 'UUID_FUNCTION'::text),
    ('email',       'character varying(255)',     TRUE, NULL::text),
    ('purpose',     'character varying(50)',      TRUE, NULL::text),
    ('otp_hash',    'character varying(255)',     TRUE, NULL::text),
    ('attempts',    'integer',                    TRUE, '0'::text),
    ('resend_after','timestamp with time zone',    TRUE, NULL::text),
    ('expires_at',  'timestamp with time zone',    TRUE, NULL::text),
    ('used',        'boolean',                    TRUE, 'false'::text),
    ('created_at',  'timestamp with time zone',    TRUE, 'now()'::text)
),
actual_columns AS (
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
         a.attnotnull AS not_null,
         CASE WHEN d.oid IS NULL THEN NULL ELSE
           pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.pg_get_expr(d.adbin, d.adrelid), '[[:space:]]+', '', 'g'
           ))
         END AS normalized_default
    FROM target t
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.relid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
),
base_column_checks AS (
  SELECT 'BASE_COLUMN:' || e.column_name AS check_name,
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN a.column_name IS NULL THEN 'MISSING'
              WHEN a.formatted_type IS DISTINCT FROM e.formatted_type
                OR a.not_null IS DISTINCT FROM e.not_null THEN 'MISMATCH'
              WHEN e.column_name = 'id' AND a.normalized_default IS NULL THEN 'MISMATCH'
              WHEN e.column_name <> 'id' AND e.expected_default IS NULL
                AND a.normalized_default IS NOT NULL THEN 'MISMATCH'
              WHEN e.column_name <> 'id' AND e.expected_default IS NOT NULL
                AND a.normalized_default IS DISTINCT FROM e.expected_default THEN 'MISMATCH'
              ELSE 'PASS' END AS result,
         pg_catalog.concat('type=', COALESCE(a.formatted_type, '<absent>'),
           '; not_null=', COALESCE(a.not_null::text, '<absent>'),
           '; default=', COALESCE(a.normalized_default, '<none>')) AS actual_value,
         pg_catalog.concat('type=', e.formatted_type,
           '; not_null=', e.not_null::text,
           '; default=', CASE WHEN e.column_name = 'id'
             THEN 'resolves to extensions.uuid_generate_v4()'
             ELSE COALESCE(e.expected_default, '<none>') END) AS expected_value,
         'Exact base-column type, nullability and default contract from migration 20261008000000; id function identity is separately resolved below.' AS explanation
    FROM expected_columns e
    CROSS JOIN target t
    LEFT JOIN actual_columns a USING (column_name)
),
base_column_count AS (
  SELECT pg_catalog.count(a.attname)::integer AS actual_count
    FROM target t
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid = t.relid AND a.attnum > 0 AND NOT a.attisdropped
),
id_default_resolution AS (
  SELECT d.oid AS default_oid,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression,
         p.oid AS function_oid,
         pn.nspname AS function_schema,
         p.proname AS function_name,
         e.extname AS extension_name,
         en.nspname AS extension_schema
    FROM target t
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid = t.relid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_depend dep
      ON dep.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass
     AND dep.objid = d.oid
     AND dep.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = dep.refobjid
    LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    LEFT JOIN pg_catalog.pg_depend ed
      ON ed.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     AND ed.objid = p.oid
     AND ed.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
     AND ed.deptype = 'e'
    LEFT JOIN pg_catalog.pg_extension e ON ed.refobjid = e.oid
    LEFT JOIN pg_catalog.pg_namespace en ON en.oid = e.extnamespace
),
purpose_column AS (
  SELECT a.attnum
    FROM target t
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.relid
   WHERE a.attname = 'purpose' AND a.attnum > 0 AND NOT a.attisdropped
),
purpose_checks AS (
  SELECT c.oid, c.conname, c.convalidated, c.connoinherit, c.conkey,
         pg_catalog.pg_get_constraintdef(c.oid, false) AS definition,
         pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_constraintdef(c.oid, false), '[[:space:]]+', '', 'g'
         )) AS normalized_definition
    FROM target t
    JOIN pg_catalog.pg_constraint c ON c.conrelid = t.relid AND c.contype = 'c'
    JOIN purpose_column p ON p.attnum = ANY(c.conkey)
),
purpose_summary AS (
  SELECT pg_catalog.count(c.oid)::integer AS constraint_count,
         pg_catalog.bool_and(c.convalidated AND NOT c.connoinherit
           AND c.conkey = ARRAY[p.attnum]::smallint[]
           AND pg_catalog.cardinality(c.conkey) = 1
           AND c.normalized_definition IS NOT DISTINCT FROM
             'check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))'
         ) AS exact_match,
         pg_catalog.string_agg(
           pg_catalog.concat(c.conname, ': ', c.definition,
             '; validated=', c.convalidated::text,
             '; noinherit=', c.connoinherit::text), ' | ' ORDER BY c.conname
         ) AS actual_value
    FROM (VALUES (1)) AS singleton(dummy)
    LEFT JOIN purpose_column p ON TRUE
    LEFT JOIN purpose_checks c ON TRUE
),
policy_summary AS (
  SELECT cl.relrowsecurity AS rls_enabled,
         (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = 'email_otps') AS policy_count,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = 'email_otps'
              AND p.policyname = 'Service role only access to email_otps'
              AND p.permissive = 'PERMISSIVE' AND p.cmd = 'ALL'
              AND p.roles = ARRAY['service_role']::name[]
              AND p.qual = 'true' AND p.with_check = 'true'
         ) AS expected_policy_exists
    FROM target t
    LEFT JOIN pg_catalog.pg_class cl ON cl.oid = t.relid
),
history_schema AS (
  SELECT c.oid AS relid,
         CASE WHEN c.oid IS NULL THEN FALSE
              ELSE c.relkind = 'r'
               AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
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
),
history_version AS (
  SELECT h.relid, h.schema_ok,
         CASE WHEN h.relid IS NULL OR NOT h.schema_ok
                    OR NOT pg_catalog.has_table_privilege(current_user, h.relid, 'SELECT') THEN NULL
              ELSE (SELECT x.version_count
                      FROM XMLTABLE('/table/row'
                        PASSING pg_catalog.query_to_xml(
                          'SELECT count(*)::bigint AS version_count FROM supabase_migrations.schema_migrations WHERE version = ''20261031150000''',
                          FALSE, FALSE, '')
                        COLUMNS version_count bigint PATH 'version_count') AS x)
          END AS version_count
    FROM history_schema h
),
target_columns AS (
  SELECT name.column_name,
         EXISTS (SELECT 1 FROM target t JOIN pg_catalog.pg_attribute a ON a.attrelid = t.relid
           WHERE a.attname = name.column_name AND a.attnum > 0 AND NOT a.attisdropped) AS present
    FROM (VALUES ('ticket_id'::text), ('verified_at'::text)) AS name(column_name)
),
target_index AS (
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'email_otps_ticket_id_uidx') AS present
),
target_rpcs AS (
  SELECT pg_catalog.count(*)::integer AS name_count,
         COALESCE(pg_catalog.string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text), '<none>') AS actual_names
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('issue_email_otp_ticket', 'complete_email_otp_verification', 'cancel_email_otp_ticket')
),
checks AS (
  SELECT 'DATABASE_IDENTITY'::text AS check_name,
         'UNKNOWN'::text AS result,
         pg_catalog.concat('database=', current_database(), '; current_user=', current_user,
           '; session_user=', session_user, '; server=', version(),
           '; address=', COALESCE(inet_server_addr()::text, '<local-or-unavailable>'),
           '; port=', COALESCE(inet_server_port()::text, '<unavailable>')) AS actual_value,
         'Selected SQL Editor project must be independently confirmed as ENCRIX Production; PostgreSQL metadata cannot prove hosted project reference.'::text AS expected_value,
         'Confirm the selected project reference in SQL Editor and match it to the authorized Vercel Production project before any write.'::text AS explanation
  UNION ALL
  SELECT 'POSTGRESQL_MAJOR_VERSION',
         CASE WHEN current_setting('server_version_num')::integer / 10000 = 17 THEN 'PASS' ELSE 'MISMATCH' END,
         current_setting('server_version'), '17.x', 'Migration repair is reviewed against PostgreSQL 17 behavior.'
  UNION ALL
  SELECT 'EMAIL_OTPS_TABLE',
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN c.relkind = 'r' THEN 'PASS' ELSE 'MISMATCH' END,
         COALESCE(c.relkind::text, '<absent>'), 'ordinary table (relkind r)',
         'The base relation must be an ordinary table before the transactional repair can lock and alter it.'
    FROM target t LEFT JOIN pg_catalog.pg_class c ON c.oid = t.relid
  UNION ALL
  SELECT 'BASE_COLUMN_COUNT',
         CASE WHEN t.relid IS NULL THEN 'MISSING' WHEN b.actual_count = 9 THEN 'PASS' ELSE 'MISMATCH' END,
         COALESCE(b.actual_count::text, '0'), '9 visible base columns',
         'Reject missing table or unexpected/missing columns; durable columns are checked separately.'
    FROM target t CROSS JOIN base_column_count b
  UNION ALL
  SELECT check_name, result, actual_value, expected_value, explanation FROM base_column_checks
  UNION ALL
  SELECT 'UUID_DEFAULT_RESOLUTION',
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN d.default_oid IS NULL THEN 'MISMATCH'
              WHEN d.function_oid = pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')
                AND d.function_schema = 'extensions' AND d.function_name = 'uuid_generate_v4'
                AND d.extension_name = 'uuid-ossp' AND d.extension_schema = 'extensions' THEN 'PASS'
              ELSE 'MISMATCH' END,
         pg_catalog.concat('default=', COALESCE(d.default_expression, '<none>'),
           '; function=', COALESCE(d.function_schema, '<unresolved>'), '.', COALESCE(d.function_name, '<unresolved>'),
           '; extension=', COALESCE(d.extension_name, '<unresolved>'), '@', COALESCE(d.extension_schema, '<unresolved>')),
         'id default resolves to extensions.uuid_generate_v4() owned by uuid-ossp installed in extensions',
         'Checks catalog dependency and owning extension; rendered default text alone is not trusted.'
    FROM target t CROSS JOIN id_default_resolution d
  UNION ALL
  SELECT 'ID_PRIMARY_KEY',
         CASE WHEN t.relid IS NULL THEN 'MISSING' WHEN EXISTS (
           SELECT 1 FROM pg_catalog.pg_constraint c
           WHERE c.conrelid = t.relid AND c.contype = 'p'
             AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
               WHERE a.attrelid = t.relid AND a.attname = 'id' AND NOT a.attisdropped)]::smallint[]
             AND pg_catalog.cardinality(c.conkey) = 1) THEN 'PASS' ELSE 'MISMATCH' END,
         (SELECT COALESCE(pg_catalog.string_agg(c.conname || ':' || c.conkey::text, ', '), '<none>')
            FROM pg_catalog.pg_constraint c WHERE c.conrelid = t.relid AND c.contype = 'p'),
         'single-column primary key on id', 'Primary key must be exactly id.'
    FROM target t
  UNION ALL
  SELECT 'PURPOSE_CONSTRAINT',
         CASE WHEN t.relid IS NULL OR NOT EXISTS (SELECT 1 FROM purpose_column) THEN 'MISSING'
              WHEN s.constraint_count = 0 THEN 'MISSING'
              WHEN s.constraint_count <> 1 OR NOT COALESCE(s.exact_match, FALSE) THEN 'MISMATCH'
              ELSE 'PASS' END,
         pg_catalog.concat('count=', s.constraint_count, '; ', COALESCE(s.actual_value, '<none>')),
         'exactly one validated, non-inherited, single-column CHECK: purpose IN (''LOGIN'', ''REGISTER'', ''INVITATION''); normalized PG17 definition uses charactervarying',
         'Full normalized definition equality is required; a changed or additional allowed value fails.'
    FROM target t CROSS JOIN purpose_summary s
  UNION ALL
  SELECT 'EMAIL_OTPS_RLS_POLICY',
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN NOT COALESCE(p.rls_enabled, FALSE) THEN 'MISMATCH'
              WHEN p.policy_count <> 1 OR NOT p.expected_policy_exists THEN 'MISMATCH'
              ELSE 'PASS' END,
         pg_catalog.concat('rls_enabled=', COALESCE(p.rls_enabled::text, 'false'),
           '; policy_count=', p.policy_count, '; expected_service_policy=', p.expected_policy_exists::text,
           '; rls_forced=', COALESCE((SELECT cl.relforcerowsecurity::text FROM target t
             LEFT JOIN pg_catalog.pg_class cl ON cl.oid = t.relid), 'false')),
         'RLS enabled; sole permissive FOR ALL policy to service_role with USING true and WITH CHECK true',
         'Reject disabled RLS, missing/changed service policy, or any additional policy.'
    FROM target t CROSS JOIN policy_summary p
  UNION ALL
  SELECT 'ROLE:' || r.rolname,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname = r.rolname) THEN 'PASS' ELSE 'MISSING' END,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname = r.rolname) THEN 'present' ELSE 'absent' END,
         'present', 'Required Supabase API role.'
    FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) r(rolname)
  UNION ALL
  SELECT 'SERVICE_ROLE_PUBLIC_USAGE',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN 'UNKNOWN'
              WHEN pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE') THEN 'PASS' ELSE 'MISMATCH' END,
         pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE')::text,
         'true', 'service_role must resolve and execute public RPCs.'
  UNION ALL
  SELECT 'EXECUTOR_PUBLIC_CREATE',
         CASE WHEN pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') THEN 'PASS' ELSE 'MISMATCH' END,
         pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')::text,
         'true', 'Repair executor must create the three RPCs in public.'
  UNION ALL
  SELECT 'EXECUTOR_PUBLIC_USAGE',
         CASE WHEN pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') THEN 'PASS' ELSE 'MISMATCH' END,
         pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE')::text,
         'true', 'Repair executor must use public.'
  UNION ALL
  SELECT 'EXECUTOR_TABLE_OWNERSHIP',
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
                WHERE c.oid = t.relid AND (r.rolname = current_user OR r.rolsuper)) THEN 'PASS'
              ELSE 'MISMATCH' END,
         CASE WHEN t.relid IS NULL THEN '<table absent>' ELSE pg_catalog.pg_get_userbyid(c.relowner) END,
         'current_user owns email_otps or is superuser', 'Repair modifies the existing table and its columns/index.'
    FROM target t LEFT JOIN pg_catalog.pg_class c ON c.oid = t.relid
  UNION ALL
  SELECT 'EXECUTOR_EMAIL_OTPS_PRIVILEGES',
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN pg_catalog.has_table_privilege(current_user, t.relid, 'SELECT')
               AND pg_catalog.has_table_privilege(current_user, t.relid, 'INSERT')
               AND pg_catalog.has_table_privilege(current_user, t.relid, 'UPDATE') THEN 'PASS'
              ELSE 'MISMATCH' END,
         CASE WHEN t.relid IS NULL THEN '<table absent>' ELSE pg_catalog.concat(
           'SELECT=', pg_catalog.has_table_privilege(current_user, t.relid, 'SELECT'),
           '; INSERT=', pg_catalog.has_table_privilege(current_user, t.relid, 'INSERT'),
           '; UPDATE=', pg_catalog.has_table_privilege(current_user, t.relid, 'UPDATE')) END,
         'executor has SELECT, INSERT and UPDATE on public.email_otps',
         'Required by the SECURITY DEFINER RPC owner for OTP lifecycle operations.'
    FROM target t
  UNION ALL
  SELECT 'EXECUTOR_UUID_DEFAULT_PRIVILEGES',
         CASE WHEN t.relid IS NULL THEN 'MISSING'
              WHEN NOT pg_catalog.has_schema_privilege(current_user, 'extensions', 'USAGE') THEN 'MISMATCH'
              WHEN NOT EXISTS (SELECT 1 FROM id_default_resolution d
                WHERE d.function_oid = pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')
                  AND pg_catalog.has_function_privilege(current_user, d.function_oid, 'EXECUTE')) THEN 'MISMATCH'
              ELSE 'PASS' END,
         pg_catalog.concat('extensions_usage=', pg_catalog.has_schema_privilege(current_user, 'extensions', 'USAGE'),
           '; uuid_function_execute=', COALESCE((SELECT pg_catalog.has_function_privilege(current_user, d.function_oid, 'EXECUTE')::text
             FROM id_default_resolution d), 'false')),
         'executor has extensions USAGE and EXECUTE on extensions.uuid_generate_v4()',
         'Repair-created RPCs insert rows that use the existing UUID default.'
    FROM target t
  UNION ALL
  SELECT 'MIGRATION_HISTORY_SCHEMA',
         CASE WHEN h.relid IS NULL THEN 'MISSING' WHEN h.schema_ok THEN 'PASS' ELSE 'MISMATCH' END,
         CASE WHEN h.relid IS NULL THEN '<relation absent>' ELSE pg_catalog.concat('relkind=', c.relkind, '; schema_contract=', h.schema_ok) END,
         'ordinary table with version text NOT NULL PRIMARY KEY, statements text[] NULL, name text NULL; exactly 3 visible columns',
         'History schema is inspected only; this preflight never modifies it.'
    FROM history_schema h LEFT JOIN pg_catalog.pg_class c ON c.oid = h.relid
  UNION ALL
  SELECT 'MIGRATION_HISTORY_20261031150000',
         CASE WHEN h.relid IS NULL THEN 'MISSING' WHEN NOT h.schema_ok THEN 'MISMATCH'
              WHEN NOT pg_catalog.has_table_privilege(current_user, h.relid, 'SELECT') THEN 'UNKNOWN'
              WHEN h.version_count = 0 THEN 'PASS' ELSE 'MISMATCH' END,
         COALESCE(h.version_count::text, '<unavailable>'), '0 rows (version absent before repair)',
         'A recorded version is a stop condition; inspect actual effects rather than repeating the repair.'
    FROM history_version h
  UNION ALL
  SELECT 'TARGET_COLUMN_ABSENT:' || c.column_name,
         CASE WHEN t.relid IS NULL THEN 'MISSING' WHEN c.present THEN 'MISMATCH' ELSE 'PASS' END,
         CASE WHEN c.present THEN 'present' ELSE 'absent' END,
         'absent before repair', 'Any existing target column is partial state and requires manual reconciliation.'
    FROM target_columns c CROSS JOIN target t
  UNION ALL
  SELECT 'TARGET_INDEX_NAME_ABSENT',
         CASE WHEN i.present THEN 'MISMATCH' ELSE 'PASS' END,
         CASE WHEN i.present THEN 'occupied' ELSE 'absent' END,
         'public.email_otps_ticket_id_uidx absent', 'Any same-named relation/index requires manual inspection.'
    FROM target_index i
  UNION ALL
  SELECT 'TARGET_RPC_NAMES_ABSENT',
         CASE WHEN r.name_count = 0 THEN 'PASS' ELSE 'MISMATCH' END,
         r.actual_names,
         'no public functions named issue_email_otp_ticket, complete_email_otp_verification, or cancel_email_otp_ticket',
         'Any overload under a target name is treated as conflicting partial state.'
    FROM target_rpcs r
)
SELECT check_name, result, actual_value, expected_value, explanation
  FROM checks
 ORDER BY check_name;
