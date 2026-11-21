SELECT 'CONSTRAINT_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, con.conname AS constraint_name,
       CASE con.contype
         WHEN 'p' THEN 'PRIMARY KEY'
         WHEN 'f' THEN 'FOREIGN KEY'
         WHEN 'u' THEN 'UNIQUE'
         WHEN 'c' THEN 'CHECK'
         WHEN 'x' THEN 'EXCLUSION'
         ELSE con.contype::text
       END AS constraint_type,
       con.convalidated AS validated,
       con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
       pg_catalog.pg_get_constraintdef(con.oid,true) AS definition,
       CASE WHEN con.conindid=0::oid THEN NULL ELSE ni.nspname END AS constraint_index_schema,
       CASE WHEN con.conindid=0::oid THEN NULL ELSE ci.relname END AS constraint_index_name,
       CASE WHEN con.conindid=0::oid THEN NULL ELSE pg_catalog.pg_get_indexdef(con.conindid) END
         AS constraint_index_definition,
       CASE WHEN con.contype='f' AND con.conindid<>0::oid
         THEN 'referenced-key index for foreign key'
         WHEN con.conindid<>0::oid THEN 'constraint enforcement index'
         ELSE NULL
       END AS constraint_index_role,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_class ci ON ci.oid=con.conindid AND con.conindid<>0::oid
LEFT JOIN pg_catalog.pg_namespace ni ON ni.oid=ci.relnamespace
WHERE n.nspname='public' ORDER BY c.relname,con.conname;
