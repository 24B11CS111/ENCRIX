-- READ-ONLY comparison of public.email_otps with migration
-- 20261008000000_email_otp_authentication.sql.
-- Run only inside the isolated local ENCRIX validation container.

BEGIN TRANSACTION READ ONLY;

SELECT
  'DATABASE_IDENTITY' AS diagnostic,
  current_database() AS database_name,
  current_user AS connected_role,
  session_user AS session_role,
  version() AS postgres_version,
  current_setting('server_version_num') AS server_version_num,
  current_setting('port') AS server_port,
  inet_server_addr()::text AS server_address,
  inet_server_port() AS server_port_number,
  inet_client_addr()::text AS client_address,
  inet_client_port() AS client_port,
  CASE
    WHEN current_database()='postgres' AND current_user='postgres'
     AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
     AND current_setting('port')='5432'
    THEN 'PASS' ELSE 'FAIL'
  END AS expected_isolated_container_identity;

SELECT
  'TABLE_EXISTENCE' AS diagnostic,
  CASE WHEN pg_catalog.to_regclass('public.email_otps') IS NULL THEN 'FAIL' ELSE 'PASS' END AS result,
  pg_catalog.to_regclass('public.email_otps') AS relation;

-- Complete live column inventory, including identity/generated flags and the
-- catalog-rendered default expression. No row values are selected.
SELECT
  'COLUMN_INVENTORY' AS diagnostic,
  a.attnum AS ordinal,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid,a.atttypmod) AS format_type,
  ic.data_type,
  ic.udt_schema,
  ic.udt_name,
  NOT a.attnotnull AS nullable,
  a.attnotnull AS not_null,
  pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
  a.attidentity AS identity_flag,
  a.attgenerated AS generated_flag
FROM pg_catalog.pg_attribute a
LEFT JOIN information_schema.columns ic
  ON ic.table_schema='public' AND ic.table_name='email_otps' AND ic.column_name=a.attname
LEFT JOIN pg_catalog.pg_attrdef d
  ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid=pg_catalog.to_regclass('public.email_otps')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;

-- Migration 080000's exact expected email_otps column contract.
WITH expected(column_name,format_type,data_type,udt_name,is_nullable,default_expression) AS (
  VALUES
    ('id','uuid','uuid','uuid','NO','extensions.uuid_generate_v4()'),
    ('email','character varying(255)','character varying','varchar','NO',NULL),
    ('purpose','character varying(50)','character varying','varchar','NO',NULL),
    ('otp_hash','character varying(255)','character varying','varchar','NO',NULL),
    ('attempts','integer','integer','int4','NO','0'),
    ('resend_after','timestamp with time zone','timestamp with time zone','timestamptz','NO',NULL),
    ('expires_at','timestamp with time zone','timestamp with time zone','timestamptz','NO',NULL),
    ('used','boolean','boolean','bool','NO','false'),
    ('created_at','timestamp with time zone','timestamp with time zone','timestamptz','NO','now()')
), actual AS (
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid,a.atttypmod) AS format_type,
         ic.data_type,
         ic.udt_name,
         ic.is_nullable,
         pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
         a.attidentity,
         a.attgenerated
    FROM pg_catalog.pg_attribute a
    LEFT JOIN information_schema.columns ic
      ON ic.table_schema='public' AND ic.table_name='email_otps' AND ic.column_name=a.attname
    LEFT JOIN pg_catalog.pg_attrdef d
      ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=pg_catalog.to_regclass('public.email_otps')
     AND a.attnum>0 AND NOT a.attisdropped
)
SELECT
  'MIGRATION_080000_COLUMN_COMPARE' AS diagnostic,
  e.column_name,
  e.format_type AS expected_format_type,
  a.format_type AS actual_format_type,
  e.data_type AS expected_data_type,
  a.data_type AS actual_data_type,
  e.udt_name AS expected_udt_name,
  a.udt_name AS actual_udt_name,
  e.is_nullable AS expected_is_nullable,
  a.is_nullable AS actual_is_nullable,
  e.default_expression AS expected_default,
  a.default_expression AS actual_default,
  a.attidentity AS actual_identity_flag,
  a.attgenerated AS actual_generated_flag,
  CASE WHEN a.column_name IS NOT NULL
         AND a.format_type IS NOT DISTINCT FROM e.format_type
         AND a.data_type IS NOT DISTINCT FROM e.data_type
         AND a.udt_name IS NOT DISTINCT FROM e.udt_name
         AND a.is_nullable IS NOT DISTINCT FROM e.is_nullable
         AND a.default_expression IS NOT DISTINCT FROM e.default_expression
         AND a.attidentity=''
         AND a.attgenerated=''
       THEN 'PASS' ELSE 'FAIL' END AS comparison
FROM expected e
LEFT JOIN actual a USING (column_name)
ORDER BY e.column_name;

SELECT
  'UNEXPECTED_EXTRA_COLUMNS' AS diagnostic,
  COALESCE(pg_catalog.array_agg(a.attname ORDER BY a.attnum),ARRAY[]::name[]) AS columns,
  CASE WHEN pg_catalog.count(a.attname)=0 THEN 'PASS' ELSE 'REVIEW' END AS result
FROM pg_catalog.pg_attribute a
WHERE a.attrelid=pg_catalog.to_regclass('public.email_otps')
  AND a.attnum>0 AND NOT a.attisdropped
  AND a.attname NOT IN ('id','email','purpose','otp_hash','attempts','resend_after','expires_at','used','created_at');

-- Explicit primary-key membership and every constraint, including validation
-- state and deparsed definition.
SELECT
  'ID_PRIMARY_KEY' AS diagnostic,
  CASE WHEN EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id' AND NOT a.attisdropped
     WHERE c.conrelid=pg_catalog.to_regclass('public.email_otps')
       AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[]
       AND pg_catalog.cardinality(c.conkey)=1
  ) THEN 'PASS' ELSE 'FAIL' END AS result;

SELECT
  'EMAIL_OTPS_CONSTRAINT' AS diagnostic,
  c.conname,
  c.contype,
  c.convalidated,
  c.condeferrable,
  c.condeferred,
  pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid=pg_catalog.to_regclass('public.email_otps')
ORDER BY c.contype,c.conname;

-- Foreign keys both owned by email_otps and pointing into it.
SELECT
  'EMAIL_OTPS_FOREIGN_KEY' AS diagnostic,
  CASE WHEN c.conrelid=pg_catalog.to_regclass('public.email_otps') THEN 'EMAIL_OTPS_REFERENCES_OTHER'
       ELSE 'OTHER_REFERENCES_EMAIL_OTPS' END AS direction,
  c.conname,
  c.conrelid::pg_catalog.regclass AS referencing_relation,
  c.confrelid::pg_catalog.regclass AS referenced_relation,
  c.convalidated,
  pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.contype='f'
  AND (c.conrelid=pg_catalog.to_regclass('public.email_otps')
       OR c.confrelid=pg_catalog.to_regclass('public.email_otps'))
ORDER BY c.conname;

SELECT
  'EMAIL_OTPS_FOREIGN_KEY_SUMMARY' AS diagnostic,
  pg_catalog.count(*)::bigint AS dependency_count,
  CASE WHEN pg_catalog.count(*)=0 THEN 'PASS|no foreign keys reference or depend on email_otps'
       ELSE 'REVIEW|inspect the foreign-key rows above before considering any future key change' END AS result
FROM pg_catalog.pg_constraint c
WHERE c.contype='f'
  AND (c.conrelid=pg_catalog.to_regclass('public.email_otps')
       OR c.confrelid=pg_catalog.to_regclass('public.email_otps'));

-- UUID extension installation and the actual function referenced by the id
-- column default, via the pg_attrdef dependency catalog.
WITH expected_extension(extname,expected_schema) AS (
  VALUES ('uuid-ossp','extensions')
)
SELECT
  'UUID_EXTENSION' AS diagnostic,
  x.extname AS expected_extension,
  e.extname,
  e.extversion,
  n.nspname AS extension_schema,
  CASE WHEN e.extname=x.extname AND n.nspname=x.expected_schema THEN 'PASS' ELSE 'FAIL' END AS expected_extension_state
FROM expected_extension x
LEFT JOIN pg_catalog.pg_extension e ON e.extname=x.extname
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace;

SELECT
  'ID_DEFAULT_FUNCTION_RESOLUTION' AS diagnostic,
  p.oid::pg_catalog.regprocedure AS resolved_function,
  pn.nspname AS function_schema,
  p.proname AS function_name,
  pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
  e.extname AS owning_extension,
  en.nspname AS extension_schema,
  CASE WHEN p.oid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')
         AND e.extname='uuid-ossp' AND en.nspname='extensions'
       THEN 'PASS' ELSE 'FAIL' END AS expected_resolution
FROM (SELECT pg_catalog.to_regclass('public.email_otps') AS relation_oid) rel
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=rel.relation_oid AND a.attname='id'
  AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
LEFT JOIN pg_catalog.pg_depend dep ON dep.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass
  AND dep.objid=ad.oid AND dep.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
LEFT JOIN pg_catalog.pg_proc p ON p.oid=dep.refobjid
LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
LEFT JOIN pg_catalog.pg_depend extdep ON extdep.classid='pg_catalog.pg_proc'::pg_catalog.regclass
  AND extdep.objid=p.oid AND extdep.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass
  AND extdep.deptype='e'
LEFT JOIN pg_catalog.pg_extension e ON e.oid=extdep.refobjid
LEFT JOIN pg_catalog.pg_namespace en ON en.oid=e.extnamespace;

-- Counts only; no IDs or other OTP/customer values are returned.
DO $email_otps_row_counts$
DECLARE
  v_total bigint;
  v_null_ids bigint;
  v_duplicate_id_groups bigint;
  v_duplicate_id_rows bigint;
  v_duplicate_excess_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.email_otps') IS NULL THEN
    RAISE NOTICE 'EMAIL_OTPS_ROW_COUNTS|FAIL|table missing';
  ELSE
    EXECUTE $count_query$
      SELECT pg_catalog.count(*)::bigint,
             pg_catalog.count(*) FILTER (WHERE id IS NULL)::bigint,
             (SELECT pg_catalog.count(*)::bigint FROM (
               SELECT id FROM public.email_otps WHERE id IS NOT NULL GROUP BY id HAVING pg_catalog.count(*)>1
             ) duplicate_ids),
             COALESCE((SELECT pg_catalog.sum(id_count)::bigint FROM (
               SELECT pg_catalog.count(*) AS id_count FROM public.email_otps
                WHERE id IS NOT NULL GROUP BY id HAVING pg_catalog.count(*)>1
             ) duplicate_rows),0),
             COALESCE((SELECT pg_catalog.sum(id_count-1)::bigint FROM (
               SELECT pg_catalog.count(*) AS id_count FROM public.email_otps
                WHERE id IS NOT NULL GROUP BY id HAVING pg_catalog.count(*)>1
             ) duplicate_excess),0)
        FROM public.email_otps
    $count_query$ INTO v_total,v_null_ids,v_duplicate_id_groups,v_duplicate_id_rows,v_duplicate_excess_rows;
    RAISE NOTICE 'EMAIL_OTPS_ROW_COUNTS|%|total=% null_ids=% duplicate_id_groups=%',
      CASE WHEN v_null_ids=0 AND v_duplicate_id_groups=0 THEN 'PASS' ELSE 'FAIL' END,
      v_total,v_null_ids,v_duplicate_id_groups;
    RAISE NOTICE 'EMAIL_OTPS_DUPLICATE_ID_COUNTS|rows_with_duplicate_ids=% excess_duplicate_rows=%',
      v_duplicate_id_rows,v_duplicate_excess_rows;
  END IF;
END;
$email_otps_row_counts$;

COMMIT;
