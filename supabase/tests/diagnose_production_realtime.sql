-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Realtime publication membership and column filters.

-- SECTION 10: Realtime membership and column filters.
SELECT 'PUBLICATION_CATALOG' AS section,p.pubname,c.relname AS relation_name,
       pr.prattrs AS published_attribute_numbers,
       CASE WHEN pr.prattrs IS NULL THEN 'ALL COLUMNS' ELSE
         (SELECT string_agg(a.attname,', ' ORDER BY u.attnum)
            FROM unnest(pr.prattrs) WITH ORDINALITY AS u(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=pr.prrelid AND a.attnum=u.attnum)
       END AS published_columns,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_publication p
LEFT JOIN pg_catalog.pg_publication_rel pr ON pr.prpubid=p.oid
LEFT JOIN pg_catalog.pg_class c ON c.oid=pr.prrelid
WHERE p.pubname='supabase_realtime' ORDER BY c.relname;
