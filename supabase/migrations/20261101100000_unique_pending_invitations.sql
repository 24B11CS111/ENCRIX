-- Prevent concurrent creation of multiple pending invitations for the same
-- organization/email. Existing duplicates are reported and require manual
-- resolution; this migration never deletes or rewrites invitation data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.organization_invitations
     WHERE status = 'PENDING' AND email IS NOT NULL
     GROUP BY organization_id, pg_catalog.lower(pg_catalog.btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_pending_organization_invitations: resolve duplicate pending rows before applying this migration';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_org_email_uidx
  ON public.organization_invitations (organization_id, pg_catalog.lower(pg_catalog.btrim(email)))
  WHERE status = 'PENDING' AND email IS NOT NULL;
