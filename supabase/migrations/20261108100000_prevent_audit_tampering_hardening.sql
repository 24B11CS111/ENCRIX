-- Hardening for public.prevent_audit_tampering() trigger-only routine.
-- Restricts search_path to pg_catalog, pg_temp and revokes execute privileges from PUBLIC, anon, and authenticated.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_audit_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Security Policy Violation: LeadVault audit trails (activity_logs, security_events) are strictly append-only. Modification and deletion are prohibited by compliance policy.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_audit_tampering() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_audit_tampering() TO service_role;

COMMIT;
