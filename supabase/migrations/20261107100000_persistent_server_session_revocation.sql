-- Persist server-signed session revocation across serverless instances.
BEGIN;

CREATE TABLE public.server_session_revocations (
  session_id TEXT PRIMARY KEY CHECK (char_length(session_id) BETWEEN 16 AND 128),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.server_session_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.server_session_revocations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_server_session_revoked(p_session_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.server_session_revocations
    WHERE session_id = p_session_id
      AND expires_at > pg_catalog.clock_timestamp()
  );
$function$;

CREATE OR REPLACE FUNCTION public.revoke_server_session(p_session_id TEXT, p_expires_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_session_id IS NULL OR char_length(p_session_id) NOT BETWEEN 16 AND 128
     OR p_expires_at IS NULL
     OR p_expires_at <= pg_catalog.clock_timestamp()
     OR p_expires_at > pg_catalog.clock_timestamp() + INTERVAL '8 days' THEN
    RAISE EXCEPTION 'server_session_revocation_invalid' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.server_session_revocations
  WHERE expires_at <= pg_catalog.clock_timestamp();

  INSERT INTO public.server_session_revocations(session_id, expires_at)
  VALUES (p_session_id, p_expires_at)
  ON CONFLICT (session_id) DO UPDATE SET expires_at = EXCLUDED.expires_at;

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_server_session_revoked(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_server_session(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_server_session_revoked(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_server_session(TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
