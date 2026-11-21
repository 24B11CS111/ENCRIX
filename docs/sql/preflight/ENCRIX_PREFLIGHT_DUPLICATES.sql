-- ENCRIX Production billing preflight: aggregate duplicate counts only.
-- No email, owner ID, or customer row is returned. Read-only SELECTs.
-- Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
SELECT 'DUPLICATES' AS section, 'profiles normalized email' AS check_name,
       count(*)::bigint AS duplicate_key_count
FROM (
  SELECT lower(btrim(to_jsonb(p)->>'email')) AS normalized_key
  FROM public.profiles AS p
  WHERE NULLIF(btrim(to_jsonb(p)->>'email'), '') IS NOT NULL
  GROUP BY lower(btrim(to_jsonb(p)->>'email')) HAVING count(*) > 1
) AS duplicates
UNION ALL
SELECT 'DUPLICATES', 'organizations owner_id', count(*)::bigint
FROM (
  SELECT to_jsonb(o)->>'owner_id' AS owner_key
  FROM public.organizations AS o
  WHERE NULLIF(to_jsonb(o)->>'owner_id', '') IS NOT NULL
  GROUP BY to_jsonb(o)->>'owner_id' HAVING count(*) > 1
) AS duplicates;
