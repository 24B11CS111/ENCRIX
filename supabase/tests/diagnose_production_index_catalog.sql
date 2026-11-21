SELECT 'INDEX_CATALOG' AS section, ni.nspname AS index_schema, ci.relname AS index_name,
       nt.nspname AS parent_schema, ct.relname AS parent_table,
       am.amname AS access_method,
       i.indisprimary AS is_primary, i.indisunique AS is_unique,
       i.indisexclusion AS is_exclusion,
       i.indnullsnotdistinct AS nulls_not_distinct,
       i.indnkeyatts AS key_attribute_count, i.indnatts AS total_attribute_count,
       i.indisvalid AS is_valid, i.indisready AS is_ready,
       pg_catalog.pg_get_expr(i.indexprs,i.indrelid) AS expression_columns,
       pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS partial_index_predicate,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ci ON ci.oid=i.indexrelid
JOIN pg_catalog.pg_namespace ni ON ni.oid=ci.relnamespace
JOIN pg_catalog.pg_class ct ON ct.oid=i.indrelid
JOIN pg_catalog.pg_namespace nt ON nt.oid=ct.relnamespace
JOIN pg_catalog.pg_am am ON am.oid=ci.relam
WHERE nt.nspname='public' ORDER BY ct.relname,ci.relname;
