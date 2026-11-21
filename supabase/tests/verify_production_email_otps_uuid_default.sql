-- Read-only UUID default and uuid-ossp membership verification.
-- Run in the independently verified ENCRIX Production SQL Editor.
-- Reads only PostgreSQL catalogs; does not read OTP/customer rows or secrets.
WITH target AS (
  SELECT pg_catalog.to_regclass('public.email_otps') AS relid
), id_column AS (
  SELECT a.attrelid, a.attnum
    FROM target t
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.relid
   WHERE a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
), id_default AS (
  SELECT ad.oid AS default_oid,
         pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
         dep.refobjid AS function_oid
    FROM id_column a
    JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    JOIN pg_catalog.pg_depend dep
      ON dep.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass
     AND dep.objid = ad.oid
     AND dep.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
), resolved AS (
  SELECT d.default_oid,
         d.default_expression,
         p.oid AS function_oid,
         p.oid::pg_catalog.regprocedure::text AS function_signature,
         p.proname AS function_name,
         pn.nspname AS function_schema,
         pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
         e.extname AS extension_name,
         en.nspname AS extension_schema,
         ed.deptype AS extension_dependency_type
    FROM id_default d
    JOIN pg_catalog.pg_proc p ON p.oid = d.function_oid
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    LEFT JOIN pg_catalog.pg_depend ed
      ON ed.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     AND ed.objid = p.oid
     AND ed.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
     AND ed.deptype = 'e'
    LEFT JOIN pg_catalog.pg_extension e ON ed.refobjid = e.oid
    LEFT JOIN pg_catalog.pg_namespace en ON en.oid = e.extnamespace
)
SELECT CASE
         WHEN t.relid IS NULL OR NOT EXISTS (SELECT 1 FROM id_column) THEN 'MISSING'
         WHEN r.default_oid IS NULL THEN 'MISMATCH'
         WHEN r.function_oid <> pg_catalog.to_regprocedure('extensions.uuid_generate_v4()') THEN 'MISMATCH'
         WHEN r.function_schema <> 'extensions' OR r.function_name <> 'uuid_generate_v4' THEN 'MISMATCH'
         WHEN r.extension_name <> 'uuid-ossp' OR r.extension_schema <> 'extensions'
           OR r.extension_dependency_type <> 'e' THEN 'MISMATCH'
         ELSE 'PASS'
       END AS result,
       t.relid::text AS table_name,
       r.default_expression AS actual_default,
       r.function_signature,
       r.function_schema,
       r.function_owner,
       r.extension_name,
       r.extension_schema,
       r.extension_dependency_type,
       'public.email_otps.id default resolves to extensions.uuid_generate_v4(), and that function is a deptype=e member of uuid-ossp installed in extensions' AS expected_value
  FROM target t
  LEFT JOIN resolved r ON TRUE;
