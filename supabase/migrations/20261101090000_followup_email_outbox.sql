-- Durable, at-most-once follow-up email delivery queue.
-- No provider calls occur in SQL. Rows are visible only through service-role RPCs.
-- Reminder history is intentionally deleted with its organization, follow-up,
-- or recipient profile (ON DELETE CASCADE below); this follows the existing
-- CRM retention/erasure behavior and avoids retaining recipient email PII after
-- its parent record is deleted.

BEGIN;

-- A missing migration-history entry can follow a manual/partial application.
-- Never accept an unknown table or silently replace an existing RPC definition.
DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.follow_up_email_outbox') IS NOT NULL THEN
    RAISE EXCEPTION 'follow_up_email_outbox already exists; inspect its complete definition before applying this migration';
  END IF;
  IF pg_catalog.to_regprocedure('public.queue_follow_up_reminder_email(uuid,uuid,uuid,text,text,text,text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.claim_follow_up_reminder_emails(uuid,integer)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.complete_follow_up_reminder_email(uuid,uuid,boolean,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'a follow-up email outbox RPC already exists; inspect its owner, body, and grants before applying this migration';
  END IF;
END;
$preflight$;

CREATE TABLE public.follow_up_email_outbox (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  follow_up_id UUID NOT NULL REFERENCES public.follow_ups(id) ON DELETE CASCADE,
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL CHECK (milestone IN ('UPCOMING_REMINDER', 'OVERDUE_ALERT', 'OWNER_ESCALATION')),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1),
  claim_token UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  failure_code TEXT,
  CONSTRAINT follow_up_email_outbox_event_unique UNIQUE (follow_up_id, recipient_profile_id, milestone),
  CONSTRAINT follow_up_email_outbox_state_check CHECK (
    (status = 'QUEUED' AND claim_token IS NULL AND claimed_at IS NULL AND sent_at IS NULL)
    OR (status = 'SENDING' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND sent_at IS NULL)
    OR (status = 'SENT' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND sent_at IS NOT NULL)
    OR (status = 'FAILED' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND sent_at IS NULL)
  )
);

ALTER TABLE public.follow_up_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.follow_up_email_outbox FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_follow_up_reminder_email(
  p_organization_id UUID,
  p_follow_up_id UUID,
  p_recipient_profile_id UUID,
  p_milestone TEXT,
  p_recipient_email TEXT,
  p_subject TEXT,
  p_text_body TEXT,
  p_html_body TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_follow_up public.follow_ups%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_follow_up_id IS NULL OR p_recipient_profile_id IS NULL
     OR p_milestone IS NULL
     OR p_milestone NOT IN ('UPCOMING_REMINDER', 'OVERDUE_ALERT', 'OWNER_ESCALATION')
     OR p_recipient_email IS NULL OR pg_catalog.length(p_recipient_email) > 320
     OR p_subject IS NULL OR pg_catalog.length(p_subject) > 200
     OR p_text_body IS NULL OR p_html_body IS NULL THEN
    RAISE EXCEPTION 'invalid_follow_up_email_payload' USING ERRCODE = '22023';
  END IF;

  SELECT f.* INTO v_follow_up
    FROM public.follow_ups AS f
    JOIN public.organizations AS g ON g.id = f.organization_id
    JOIN public.leads AS l
      ON l.id = f.lead_id AND l.organization_id = f.organization_id
    JOIN public.profiles AS a
      ON a.id = f.assigned_to
     AND a.organization_id = f.organization_id
     AND a.role = 'TELECALLER'
   WHERE f.id = p_follow_up_id
     AND f.organization_id = p_organization_id
     AND f.status NOT IN ('COMPLETED', 'MISSED', 'CANCELLED');
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT p.* INTO v_profile
    FROM public.profiles AS p
    JOIN public.organizations AS g ON g.id = p.organization_id
   WHERE p.id = p_recipient_profile_id
     AND g.id = p_organization_id
     AND p.status = 'ACTIVE'
     AND p.email_verified = TRUE
     AND p.email IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(p.email)) = pg_catalog.lower(pg_catalog.btrim(p_recipient_email))
     AND ((p_milestone = 'OWNER_ESCALATION' AND p.role = 'OWNER' AND g.owner_id = p.user_id)
       OR (p_milestone <> 'OWNER_ESCALATION' AND p.role = 'TELECALLER' AND p.id = v_follow_up.assigned_to));
  IF NOT FOUND THEN RETURN FALSE; END IF;

  INSERT INTO public.follow_up_email_outbox (
    organization_id, follow_up_id, recipient_profile_id, milestone,
    recipient_email, subject, text_body, html_body
  ) VALUES (
    p_organization_id, p_follow_up_id, p_recipient_profile_id, p_milestone,
    pg_catalog.lower(pg_catalog.btrim(p_recipient_email)), p_subject, p_text_body, p_html_body
  ) ON CONFLICT (follow_up_id, recipient_profile_id, milestone) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_follow_up_reminder_emails(p_organization_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID, claim_token UUID, recipient_email TEXT, subject TEXT,
  text_body TEXT, html_body TEXT, milestone TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid_follow_up_email_batch_size' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT o.id,
           EXISTS (
             SELECT 1
               FROM public.organizations AS g
               JOIN public.follow_ups AS f
                 ON f.id = o.follow_up_id
                AND f.organization_id = g.id
               JOIN public.leads AS l
                 ON l.id = f.lead_id
                AND l.organization_id = f.organization_id
               JOIN public.profiles AS a
                 ON a.id = f.assigned_to
                AND a.organization_id = f.organization_id
                AND a.role = 'TELECALLER'
               JOIN public.profiles AS p
                 ON p.id = o.recipient_profile_id
                AND p.organization_id = g.id
              WHERE g.id = o.organization_id
                AND f.status NOT IN ('COMPLETED', 'MISSED', 'CANCELLED')
                AND p.status = 'ACTIVE'
                AND p.email_verified IS TRUE
                AND p.email IS NOT NULL
                AND pg_catalog.lower(pg_catalog.btrim(p.email)) =
                    pg_catalog.lower(pg_catalog.btrim(o.recipient_email))
                AND (
                  (o.milestone = 'OWNER_ESCALATION'
                    AND p.role = 'OWNER'
                    AND g.owner_id = p.user_id)
                  OR
                  (o.milestone IN ('UPCOMING_REMINDER', 'OVERDUE_ALERT')
                    AND p.role = 'TELECALLER'
                    AND p.id = f.assigned_to)
                )
              -- Serialize eligibility against concurrent profile, assignment,
              -- lead, and organization changes while this claim transaction runs.
              FOR SHARE OF g, f, l, a, p
           ) AS authorized
      FROM public.follow_up_email_outbox AS o
     WHERE o.status = 'QUEUED'
       AND (p_organization_id IS NULL OR o.organization_id = p_organization_id)
     ORDER BY o.created_at, o.id
     FOR UPDATE OF o SKIP LOCKED
     LIMIT p_limit
  ), suppressed AS (
    UPDATE public.follow_up_email_outbox AS o
       SET status = 'FAILED', attempts = 1,
           claim_token = pg_catalog.gen_random_uuid(), claimed_at = v_now,
           failure_code = 'RECIPIENT_NO_LONGER_AUTHORIZED'
      FROM candidates AS c
     WHERE o.id = c.id AND c.authorized IS NOT TRUE
    RETURNING o.id
  ), claimed AS (
    UPDATE public.follow_up_email_outbox AS o
       SET status = 'SENDING', attempts = 1,
           claim_token = pg_catalog.gen_random_uuid(), claimed_at = v_now
      FROM candidates AS c
     WHERE o.id = c.id AND c.authorized IS TRUE
    RETURNING o.id, o.claim_token, o.recipient_email, o.subject, o.text_body, o.html_body, o.milestone
  ) SELECT c.id, c.claim_token, c.recipient_email, c.subject, c.text_body, c.html_body, c.milestone FROM claimed AS c;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_follow_up_reminder_email(
  p_id UUID, p_claim_token UUID, p_sent BOOLEAN,
  p_provider_message_id TEXT DEFAULT NULL, p_failure_code TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_id IS NULL OR p_claim_token IS NULL OR p_sent IS NULL THEN
    RAISE EXCEPTION 'invalid_follow_up_email_completion' USING ERRCODE = '22023';
  END IF;
  UPDATE public.follow_up_email_outbox AS o
     SET status = CASE WHEN p_sent THEN 'SENT' ELSE 'FAILED' END,
         sent_at = CASE WHEN p_sent THEN pg_catalog.clock_timestamp() ELSE NULL END,
         provider_message_id = CASE WHEN p_sent THEN p_provider_message_id ELSE NULL END,
         failure_code = CASE WHEN p_sent THEN NULL ELSE COALESCE(p_failure_code, 'DELIVERY_FAILED') END
   WHERE o.id = p_id AND o.claim_token = p_claim_token AND o.status = 'SENDING';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_follow_up_reminder_email(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_follow_up_reminder_emails(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_follow_up_reminder_email(UUID, UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_follow_up_reminder_email(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_follow_up_reminder_emails(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_follow_up_reminder_email(UUID, UUID, BOOLEAN, TEXT, TEXT) TO service_role;

COMMIT;
