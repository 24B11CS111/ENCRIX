-- READ-ONLY post-repair verification for durable email OTP objects.
-- Run only in the independently confirmed ENCRIX production SQL Editor.
-- No OTP records or other customer data are selected.

-- 1. Database identity for operator confirmation against the SQL Editor project.
SELECT current_database() AS database_name,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS postgres_version,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;

-- 2. History is evidence only; this query does not modify migration records.
WITH expected(version) AS (
  VALUES ('20261001000000'), ('20261007000000'),
         ('20261008000000'), ('20261031150000')
)
SELECT e.version,
       pg_catalog.count(m.version) AS recorded_count
  FROM expected e
  LEFT JOIN supabase_migrations.schema_migrations m ON m.version = e.version
 GROUP BY e.version
 ORDER BY e.version;

-- 3. Base email_otps contract from migration 080000. Rows are not read.
WITH expected(column_name, formatted_type, expected_default) AS (
  VALUES ('id', 'uuid', 'uuid_generate_v4()'),
         ('email', 'character varying(255)', NULL),
         ('purpose', 'character varying(50)', NULL),
         ('otp_hash', 'character varying(255)', NULL),
         ('attempts', 'integer', '0'),
         ('resend_after', 'timestamp with time zone', NULL),
         ('expires_at', 'timestamp with time zone', NULL),
         ('used', 'boolean', 'false'),
         ('created_at', 'timestamp with time zone', 'now()')
), actual AS (
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
         a.attnotnull AS is_not_null,
         CASE WHEN d.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_expr(d.adbin, d.adrelid) END AS default_expression
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = pg_catalog.to_regclass('public.email_otps')
     AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT e.column_name,
       e.formatted_type AS expected_type,
       a.formatted_type AS actual_type,
       TRUE AS expected_not_null,
       a.is_not_null AS actual_not_null,
       e.expected_default,
       a.default_expression,
       CASE WHEN a.column_name IS NULL THEN 'MISSING'
            WHEN a.formatted_type = e.formatted_type AND a.is_not_null
             AND ((e.column_name = 'id' AND a.default_expression IS NOT NULL)
               OR (e.column_name <> 'id' AND
                   (e.expected_default IS NULL AND a.default_expression IS NULL
                    OR e.expected_default IS NOT NULL AND
                       pg_catalog.lower(pg_catalog.regexp_replace(a.default_expression, '[[:space:]]+', '', 'g')) = e.expected_default)))
            THEN 'TYPE_NULLABILITY_DEFAULT_MATCH; VERIFY_ID_FUNCTION_RESOLUTION_BELOW'
            ELSE 'MISMATCH' END AS result
  FROM expected e LEFT JOIN actual a USING (column_name)
 ORDER BY e.column_name;

-- 4. The durable columns must exist with the migration-defined type/nullability.
WITH expected(column_name, formatted_type, is_nullable) AS (
  VALUES ('ticket_id', 'uuid', TRUE),
         ('verified_at', 'timestamp with time zone', TRUE)
), actual AS (
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
         NOT a.attnotnull AS is_nullable
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = pg_catalog.to_regclass('public.email_otps')
     AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT e.column_name,
       e.formatted_type AS expected_type,
       a.formatted_type AS actual_type,
       e.is_nullable AS expected_nullable,
       a.is_nullable AS actual_nullable,
       CASE WHEN a.column_name IS NULL THEN 'MISSING'
            WHEN a.formatted_type = e.formatted_type
             AND a.is_nullable = e.is_nullable THEN 'PASS'
            ELSE 'MISMATCH' END AS result
  FROM expected e LEFT JOIN actual a USING (column_name)
 ORDER BY e.column_name;

-- 5. Exact named partial unique index contract.
SELECT CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'UNKNOWN'
            WHEN i.indexrelid IS NULL AND c.oid IS NOT NULL THEN 'CONFLICTING_NON_INDEX_OBJECT'
            WHEN i.indexrelid IS NULL THEN 'MISSING'
            WHEN i.indrelid = 'public.email_otps'::pg_catalog.regclass
             AND i.indisunique AND i.indisvalid AND i.indisready
             AND i.indnkeyatts = 1 AND i.indnatts = 1
             AND i.indkey[0] = (SELECT a.attnum FROM pg_catalog.pg_attribute a
                                WHERE a.attrelid = i.indrelid AND a.attname = 'ticket_id'
                                  AND NOT a.attisdropped)
             AND pg_catalog.lower(pg_catalog.regexp_replace(
                   pg_catalog.pg_get_expr(i.indpred, i.indrelid), '\s+', '', 'g'
                 )) = '(ticket_idisnotnull)'
            THEN 'PASS' ELSE 'MISMATCH' END AS index_result,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS actual_definition
  FROM (SELECT 1) seed
  LEFT JOIN pg_catalog.pg_class c
    ON c.relnamespace = 'public'::pg_catalog.regnamespace
   AND c.relname = 'email_otps_ticket_id_uidx'
  LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid;

-- 6. Three exact RPC definitions, owner/security metadata, and effective/stored grants.
WITH targets(signature, proc_oid) AS (
  VALUES
    ('public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)',
     pg_catalog.to_regprocedure('public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)')),
    ('public.complete_email_otp_verification(uuid,text,text,boolean)',
     pg_catalog.to_regprocedure('public.complete_email_otp_verification(uuid,text,text,boolean)')),
    ('public.cancel_email_otp_ticket(uuid,text,text)',
     pg_catalog.to_regprocedure('public.cancel_email_otp_ticket(uuid,text,text)'))
)
SELECT t.signature,
       p.oid IS NOT NULL AS exists,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_userbyid(p.proowner) END AS owner,
       p.prosecdef AS security_definer,
       CASE WHEN p.oid IS NULL THEN NULL ELSE l.lanname END AS language,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_function_arguments(p.oid) END AS arguments,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_function_result(p.oid) END AS return_type,
       p.proconfig AS function_settings,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_role_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
       ) END AS public_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a WHERE a.grantee = 'service_role'::pg_catalog.regrole
           AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable
       ) END AS stored_service_role_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(p.oid) END AS definition
  FROM targets t
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = t.proc_oid
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
 ORDER BY t.signature;

-- 7. UUID default function/extension and base RLS policy contract.
SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS id_default_expression,
       pn.nspname AS resolved_function_schema,
       p.proname AS resolved_function_name,
       e.extname AS owning_extension,
       en.nspname AS extension_schema,
       CASE WHEN rel.table_oid IS NULL THEN 'UNKNOWN_TABLE_MISSING'
            WHEN a.attname IS NULL THEN 'MISSING_ID_COLUMN'
            WHEN d.oid IS NULL THEN 'MISSING_DEFAULT'
            WHEN p.oid = pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')
             AND e.extname = 'uuid-ossp' AND en.nspname = 'extensions'
            THEN 'PASS' ELSE 'MISMATCH' END AS expected_function_resolution
  FROM (SELECT pg_catalog.to_regclass('public.email_otps') AS table_oid) rel
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = rel.table_oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass
    AND dep.objid = d.oid AND dep.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = dep.refobjid
  LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_depend extdep ON extdep.classid = 'pg_catalog.pg_extension'::pg_catalog.regclass
    AND extdep.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    AND extdep.refobjid = p.oid AND extdep.deptype = 'e'
  LEFT JOIN pg_catalog.pg_extension e ON e.oid = extdep.objid
  LEFT JOIN pg_catalog.pg_namespace en ON en.oid = e.extnamespace
;

-- 8. RLS and the migration-080000 service-role policy remain present.
SELECT c.relrowsecurity AS rls_enabled,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = 'email_otps'
            AND p.policyname = 'Service role only access to email_otps'
            AND p.cmd = 'ALL' AND 'service_role' = ANY (p.roles)
            AND p.qual = 'true' AND p.with_check = 'true'
       ) AS expected_service_role_policy_present
  FROM (SELECT pg_catalog.to_regclass('public.email_otps') AS oid) r
  LEFT JOIN pg_catalog.pg_class c ON c.oid = r.oid;
