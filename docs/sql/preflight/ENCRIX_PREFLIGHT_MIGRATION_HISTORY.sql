-- ENCRIX Production billing preflight: expected migration history only.
-- Read-only SELECT. Missing history rows do not prove that migration effects are absent.
-- Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr before execution.
SELECT 'MIGRATION_HISTORY' AS section,
       expected.version,
       CASE WHEN history.version IS NULL THEN 'NOT_RECORDED' ELSE 'RECORDED' END AS result
FROM (VALUES
  ('20261001000000'), ('20261001000001'), ('20261006000000'), ('20261007000000'),
  ('20261008000000'), ('20261012000000'), ('20261013000000'), ('20261014000000'),
  ('20261015000000'), ('20261018000000'), ('20261019000000'), ('20261020000000'),
  ('20261021000000'), ('20261022000000'), ('20261023000000'), ('20261023120000'),
  ('20261024100000'), ('20261024120000'), ('20261024130000'), ('20261027000000'),
  ('20261028000000'), ('20261030000000'), ('20261030120000'), ('20261031000000'),
  ('20261031120000'), ('20261031130000'), ('20261031140000'), ('20261031150000'),
  ('20261031160000'), ('20261031170000'), ('20261031180000'), ('20261101090000'),
  ('20261101100000'), ('20261104120000'), ('20261105130000'), ('20261105140000'),
  ('20261105150000'), ('20261105160000'), ('20261105170000'), ('20261106100000'),
  ('20261107100000'), ('20261108100000')
) AS expected(version)
LEFT JOIN supabase_migrations.schema_migrations AS history
  ON history.version::text = expected.version
ORDER BY expected.version;
