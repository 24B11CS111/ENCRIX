-- Harden only the search_path setting of the reviewed SECURITY DEFINER
-- functions. Function bodies, owners, SECURITY DEFINER flags, and EXECUTE ACLs
-- are intentionally unchanged.
BEGIN;

DO $preflight$
DECLARE
  v_signature regprocedure;
  v_is_security_definer boolean;
BEGIN
  FOR v_signature IN
    SELECT unnest(ARRAY[
      'public.begin_caller_phone_enrollment(uuid,uuid,text,text)'::regprocedure,
      'public.complete_caller_phone_enrollment(uuid,uuid,boolean)'::regprocedure,
      'public.can_access_call_recording(uuid,uuid)'::regprocedure,
      'public.can_access_call_recording(uuid)'::regprocedure,
      'public.can_access_call_recording_path(text)'::regprocedure,
      'public.get_telecaller_student_detail_legacy(uuid)'::regprocedure,
      'public.is_caller_active()'::regprocedure,
      'public.restrict_telecaller_lead_update_columns()'::regprocedure
    ]::regprocedure[])
  LOOP
    SELECT p.prosecdef
      INTO v_is_security_definer
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_signature::oid;

    IF NOT FOUND OR v_is_security_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Expected existing SECURITY DEFINER function %, refusing path-only hardening',
        v_signature;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER FUNCTION public.begin_caller_phone_enrollment(uuid, uuid, text, text)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.complete_caller_phone_enrollment(uuid, uuid, boolean)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.can_access_call_recording(uuid, uuid)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.can_access_call_recording(uuid)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.can_access_call_recording_path(text)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.get_telecaller_student_detail_legacy(uuid)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.is_caller_active()
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.restrict_telecaller_lead_update_columns()
  SET search_path = pg_catalog, pg_temp;

COMMIT;
