BEGIN;

DO $$
DECLARE
  v_signature TEXT;
  v_oid REGPROCEDURE;
  v_config TEXT[];
BEGIN
  IF to_regclass('public.follow_up_email_outbox') IS NULL THEN
    RAISE EXCEPTION 'FAIL: follow_up_email_outbox is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.follow_up_email_outbox'::regclass) THEN
    RAISE EXCEPTION 'FAIL: outbox RLS is disabled';
  END IF;
  IF has_table_privilege('anon', 'public.follow_up_email_outbox', 'SELECT')
     OR has_table_privilege('anon', 'public.follow_up_email_outbox', 'INSERT')
     OR has_table_privilege('anon', 'public.follow_up_email_outbox', 'UPDATE')
     OR has_table_privilege('anon', 'public.follow_up_email_outbox', 'DELETE')
     OR has_table_privilege('authenticated', 'public.follow_up_email_outbox', 'SELECT')
     OR has_table_privilege('authenticated', 'public.follow_up_email_outbox', 'INSERT')
     OR has_table_privilege('authenticated', 'public.follow_up_email_outbox', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.follow_up_email_outbox', 'DELETE')
     OR has_table_privilege('service_role', 'public.follow_up_email_outbox', 'SELECT')
     OR has_table_privilege('service_role', 'public.follow_up_email_outbox', 'INSERT')
     OR has_table_privilege('service_role', 'public.follow_up_email_outbox', 'UPDATE')
     OR has_table_privilege('service_role', 'public.follow_up_email_outbox', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: API roles have direct outbox table privileges';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.queue_follow_up_reminder_email(uuid,uuid,uuid,text,text,text,text,text)',
    'public.claim_follow_up_reminder_emails(uuid,integer)',
    'public.complete_follow_up_reminder_email(uuid,uuid,boolean,text,text)'
  ] LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: function missing: %', v_signature; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'FAIL: function is not SECURITY DEFINER: %', v_signature;
    END IF;
    SELECT proconfig INTO v_config FROM pg_proc WHERE oid = v_oid;
    IF NOT ('search_path=pg_catalog, pg_temp' = ANY(COALESCE(v_config, ARRAY[]::TEXT[]))) THEN
      RAISE EXCEPTION 'FAIL: unsafe search_path on %: %', v_signature, v_config;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: unexpected API execution grants on %', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.follow_up_email_outbox'::regclass
       AND conname = 'follow_up_email_outbox_event_unique'
       AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'FAIL: one-email-per-follow-up-milestone uniqueness constraint missing';
  END IF;
  RAISE NOTICE 'PASS: outbox RLS, direct privileges, SECURITY DEFINER search_path, service-role RPC grants, and event uniqueness';
END;
$$;

DO $authorization_test$
DECLARE
  v_org_a UUID := pg_catalog.gen_random_uuid();
  v_org_b UUID := pg_catalog.gen_random_uuid();
  v_owner_user_a UUID := pg_catalog.gen_random_uuid();
  v_owner_user_b UUID := pg_catalog.gen_random_uuid();
  v_owner_a UUID := pg_catalog.gen_random_uuid();
  v_owner_b UUID := pg_catalog.gen_random_uuid();
  v_active UUID := pg_catalog.gen_random_uuid();
  v_disabled UUID := pg_catalog.gen_random_uuid();
  v_unverified UUID := pg_catalog.gen_random_uuid();
  v_changed_email UUID := pg_catalog.gen_random_uuid();
  v_reassigned UUID := pg_catalog.gen_random_uuid();
  v_replacement UUID := pg_catalog.gen_random_uuid();
  v_deleted_profile UUID := pg_catalog.gen_random_uuid();
  v_lead_a UUID := pg_catalog.gen_random_uuid();
  v_lead_b UUID := pg_catalog.gen_random_uuid();
  v_f_active UUID := pg_catalog.gen_random_uuid();
  v_f_disabled UUID := pg_catalog.gen_random_uuid();
  v_f_unverified UUID := pg_catalog.gen_random_uuid();
  v_f_changed_email UUID := pg_catalog.gen_random_uuid();
  v_f_reassigned UUID := pg_catalog.gen_random_uuid();
  v_f_org_mismatch UUID := pg_catalog.gen_random_uuid();
  v_f_deleted_followup UUID := pg_catalog.gen_random_uuid();
  v_f_deleted_profile UUID := pg_catalog.gen_random_uuid();
  v_f_org_b UUID := pg_catalog.gen_random_uuid();
  v_email_suffix TEXT := pg_catalog.replace(pg_catalog.gen_random_uuid()::TEXT, '-', '');
  v_owner_email TEXT;
  v_owner_b_email TEXT;
  v_active_email TEXT;
  v_disabled_email TEXT;
  v_unverified_email TEXT;
  v_before_email TEXT;
  v_after_email TEXT;
  v_old_assignee_email TEXT;
  v_new_assignee_email TEXT;
  v_deleted_email TEXT;
  v_caller_b_email TEXT;
  v_caller_b UUID;
  v_returned_emails TEXT[];
  v_returned_count INTEGER;
  v_failed_delivery_id UUID;
  v_failed_delivery_token UUID;
  v_definition TEXT;
BEGIN
  v_owner_email := 'owner-a-' || v_email_suffix || '@outbox.test';
  v_owner_b_email := 'owner-b-' || v_email_suffix || '@outbox.test';
  v_active_email := 'active-' || v_email_suffix || '@outbox.test';
  v_disabled_email := 'disabled-' || v_email_suffix || '@outbox.test';
  v_unverified_email := 'unverified-' || v_email_suffix || '@outbox.test';
  v_before_email := 'before-' || v_email_suffix || '@outbox.test';
  v_after_email := 'after-' || v_email_suffix || '@outbox.test';
  v_old_assignee_email := 'old-assignee-' || v_email_suffix || '@outbox.test';
  v_new_assignee_email := 'new-assignee-' || v_email_suffix || '@outbox.test';
  v_deleted_email := 'deleted-' || v_email_suffix || '@outbox.test';
  v_caller_b_email := 'caller-b-' || v_email_suffix || '@outbox.test';

  INSERT INTO public.organizations (id, name, slug, owner_id, status) VALUES
    (v_org_a, 'Outbox authorization A', 'outbox-auth-' || v_org_a::TEXT, v_owner_user_a, 'ACTIVE'),
    (v_org_b, 'Outbox authorization B', 'outbox-auth-' || v_org_b::TEXT, v_owner_user_b, 'ACTIVE');

  INSERT INTO public.profiles (
    id, user_id, organization_id, full_name, role, status, email, email_verified
  ) VALUES
    (v_owner_a, v_owner_user_a, v_org_a, 'Outbox Owner A', 'OWNER', 'ACTIVE', v_owner_email, TRUE),
    (v_owner_b, v_owner_user_b, v_org_b, 'Outbox Owner B', 'OWNER', 'ACTIVE', v_owner_b_email, TRUE),
    (v_active, pg_catalog.gen_random_uuid(), v_org_a, 'Active Caller', 'TELECALLER', 'ACTIVE', v_active_email, TRUE),
    (v_disabled, pg_catalog.gen_random_uuid(), v_org_a, 'Disabled Caller', 'TELECALLER', 'ACTIVE', v_disabled_email, TRUE),
    (v_unverified, pg_catalog.gen_random_uuid(), v_org_a, 'Unverified Caller', 'TELECALLER', 'ACTIVE', v_unverified_email, TRUE),
    (v_changed_email, pg_catalog.gen_random_uuid(), v_org_a, 'Changed Email Caller', 'TELECALLER', 'ACTIVE', v_before_email, TRUE),
    (v_reassigned, pg_catalog.gen_random_uuid(), v_org_a, 'Old Assignee', 'TELECALLER', 'ACTIVE', v_old_assignee_email, TRUE),
    (v_replacement, pg_catalog.gen_random_uuid(), v_org_a, 'New Assignee', 'TELECALLER', 'ACTIVE', v_new_assignee_email, TRUE),
    (v_deleted_profile, pg_catalog.gen_random_uuid(), v_org_a, 'Deleted Caller', 'TELECALLER', 'ACTIVE', v_deleted_email, TRUE),
    (pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), v_org_b, 'Caller B', 'TELECALLER', 'ACTIVE', v_caller_b_email, TRUE);

  SELECT p.id INTO STRICT v_replacement FROM public.profiles AS p
   WHERE p.organization_id = v_org_a AND p.full_name = 'New Assignee';
  -- Resolve the organization-B test recipient without relying on a client-supplied ID.
  SELECT p.id INTO STRICT v_caller_b FROM public.profiles AS p
   WHERE p.organization_id = v_org_b AND p.full_name = 'Caller B';

    INSERT INTO public.leads (id, organization_id, lead_code, name, phone, assigned_to) VALUES
      (v_lead_a, v_org_a, 'OUTBOX-' || v_lead_a::TEXT, 'Outbox Lead A', '+919100000001', v_active),
      (v_lead_b, v_org_b, 'OUTBOX-' || v_lead_b::TEXT, 'Outbox Lead B', '+919100000002', v_caller_b);

    INSERT INTO public.follow_ups (id, organization_id, lead_id, assigned_to, scheduled_at) VALUES
      (v_f_active, v_org_a, v_lead_a, v_active, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_disabled, v_org_a, v_lead_a, v_disabled, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_unverified, v_org_a, v_lead_a, v_unverified, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_changed_email, v_org_a, v_lead_a, v_changed_email, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_reassigned, v_org_a, v_lead_a, v_reassigned, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_org_mismatch, v_org_a, v_lead_b, v_active, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_deleted_followup, v_org_a, v_lead_a, v_active, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_deleted_profile, v_org_a, v_lead_a, v_deleted_profile, pg_catalog.clock_timestamp() + INTERVAL '1 hour'),
      (v_f_org_b, v_org_b, v_lead_b, v_caller_b, pg_catalog.clock_timestamp() + INTERVAL '1 hour');

    -- Enqueue only while each recipient is currently authorized. Subsequent
    -- changes below must be caught again by the claim-time authorization.
    IF NOT public.queue_follow_up_reminder_email(v_org_a, v_f_active, v_active,
        'UPCOMING_REMINDER', v_active_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_disabled, v_disabled,
        'UPCOMING_REMINDER', v_disabled_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_unverified, v_unverified,
        'UPCOMING_REMINDER', v_unverified_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_changed_email, v_changed_email,
        'UPCOMING_REMINDER', v_before_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_reassigned, v_reassigned,
        'UPCOMING_REMINDER', v_old_assignee_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_deleted_followup, v_active,
        'OVERDUE_ALERT', v_active_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_deleted_profile, v_deleted_profile,
        'UPCOMING_REMINDER', v_deleted_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_active, v_owner_a,
        'OWNER_ESCALATION', v_owner_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_a, v_f_active, v_active,
         'OVERDUE_ALERT', v_active_email, 'Test', 'Fixture', '<p>Fixture</p>')
       OR NOT public.queue_follow_up_reminder_email(v_org_b, v_f_org_b, v_caller_b,
        'UPCOMING_REMINDER', v_caller_b_email, 'Test', 'Fixture', '<p>Fixture</p>') THEN
      RAISE EXCEPTION 'FAIL: a valid active, verified, correctly related recipient could not be queued';
    END IF;

    IF public.queue_follow_up_reminder_email(v_org_a, v_f_org_mismatch, v_active,
        'UPCOMING_REMINDER', v_active_email, 'Test', 'Fixture', '<p>Fixture</p>') THEN
      RAISE EXCEPTION 'FAIL: enqueue accepted a follow-up whose lead belongs to another organization';
    END IF;
    IF public.queue_follow_up_reminder_email(v_org_a, v_f_active, v_active,
        'UPCOMING_REMINDER', v_active_email, 'Test', 'Fixture', '<p>Duplicate</p>') THEN
      RAISE EXCEPTION 'FAIL: duplicate follow-up milestone reminder was enqueued';
    END IF;

    -- Model authorized owner actions that disable recipients, revoke verification,
    -- change the verified address, and reassign a follow-up after enqueue.
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_owner_user_a::TEXT, TRUE);
    PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', TRUE);
    UPDATE public.profiles SET status = 'DISABLED' WHERE id = v_disabled;
    UPDATE public.profiles SET email_verified = FALSE WHERE id = v_unverified;
    UPDATE public.profiles SET email = v_after_email WHERE id = v_changed_email;
    UPDATE public.follow_ups SET assigned_to = v_replacement WHERE id = v_f_reassigned;
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM pg_catalog.set_config('request.jwt.claim.role', '', TRUE);

    -- These rows have valid individual foreign keys but deliberately mismatch
    -- the outbox tenant/recipient or the follow-up-to-lead tenant relationship.
    INSERT INTO public.follow_up_email_outbox (
      organization_id, follow_up_id, recipient_profile_id, milestone,
      recipient_email, subject, text_body, html_body
    ) VALUES
      (v_org_a, v_f_active, v_owner_b, 'OWNER_ESCALATION',
       v_owner_b_email, 'Test', 'Fixture', '<p>Fixture</p>'),
      (v_org_a, v_f_org_mismatch, v_active, 'UPCOMING_REMINDER',
       v_active_email, 'Test', 'Fixture', '<p>Fixture</p>');

    DELETE FROM public.follow_ups WHERE id = v_f_deleted_followup;
    IF EXISTS (SELECT 1 FROM public.follow_up_email_outbox WHERE follow_up_id = v_f_deleted_followup) THEN
      RAISE EXCEPTION 'FAIL: deleting a follow-up did not cascade its reminder history';
    END IF;
    DELETE FROM public.profiles WHERE id = v_deleted_profile;
    IF EXISTS (SELECT 1 FROM public.follow_up_email_outbox WHERE recipient_profile_id = v_deleted_profile) THEN
      RAISE EXCEPTION 'FAIL: deleting a recipient did not cascade its reminder history';
    END IF;

    WITH claimed AS MATERIALIZED (
      SELECT * FROM public.claim_follow_up_reminder_emails(v_org_a, 50)
    )
    SELECT pg_catalog.array_agg(c.recipient_email ORDER BY c.recipient_email),
           (pg_catalog.array_agg(c.id) FILTER (WHERE c.milestone='OVERDUE_ALERT'))[1],
           (pg_catalog.array_agg(c.claim_token) FILTER (WHERE c.milestone='OVERDUE_ALERT'))[1]
      INTO v_returned_emails,v_failed_delivery_id,v_failed_delivery_token
      FROM claimed AS c;
    IF COALESCE(pg_catalog.cardinality(v_returned_emails), 0) <> 3
       OR NOT COALESCE(v_active_email = ANY(v_returned_emails), FALSE)
       OR NOT COALESCE(v_owner_email = ANY(v_returned_emails), FALSE) THEN
      RAISE EXCEPTION 'FAIL: claim returned unexpected authorized recipients: %', v_returned_emails;
    END IF;
    IF v_failed_delivery_id IS NULL OR v_failed_delivery_token IS NULL THEN
      RAISE EXCEPTION 'FAIL: valid claimed delivery did not include its completion token';
    END IF;
    IF public.complete_follow_up_reminder_email(v_failed_delivery_id, pg_catalog.gen_random_uuid(), FALSE,
         NULL, 'TEST_PROVIDER_UNCERTAIN') THEN
      RAISE EXCEPTION 'FAIL: completion accepted a mismatched claim token';
    END IF;
    IF NOT public.complete_follow_up_reminder_email(v_failed_delivery_id, v_failed_delivery_token, FALSE,
         NULL, 'TEST_PROVIDER_UNCERTAIN') THEN
      RAISE EXCEPTION 'FAIL: valid uncertain provider failure was not recorded';
    END IF;
    IF public.complete_follow_up_reminder_email(v_failed_delivery_id, v_failed_delivery_token, FALSE,
         NULL, 'TEST_PROVIDER_UNCERTAIN') THEN
      RAISE EXCEPTION 'FAIL: completed delivery accepted a replayed completion';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.follow_up_email_outbox WHERE id=v_failed_delivery_id
         AND status='FAILED' AND attempts=1 AND failure_code='TEST_PROVIDER_UNCERTAIN' AND sent_at IS NULL) THEN
      RAISE EXCEPTION 'FAIL: uncertain delivery state is not terminal and truthful';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.follow_up_email_outbox
       WHERE id IN (
         SELECT id FROM public.follow_up_email_outbox
          WHERE follow_up_id IN (v_f_disabled, v_f_unverified, v_f_changed_email,
                                 v_f_reassigned, v_f_org_mismatch, v_f_active)
       )
         AND (recipient_profile_id IN (v_disabled, v_unverified, v_changed_email, v_reassigned, v_owner_b)
           OR follow_up_id IN (v_f_reassigned, v_f_org_mismatch))
         AND (status <> 'FAILED' OR failure_code <> 'RECIPIENT_NO_LONGER_AUTHORIZED')
    ) THEN
      RAISE EXCEPTION 'FAIL: an unauthorized or mismatched queued reminder was not suppressed';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.claim_follow_up_reminder_emails(v_org_a, 50)
    ) THEN
      RAISE EXCEPTION 'FAIL: a repeated competing claim returned an already claimed or suppressed reminder';
    END IF;
    BEGIN
      PERFORM 1 FROM public.claim_follow_up_reminder_emails(v_org_a, 51);
      RAISE EXCEPTION 'FAIL: claim RPC accepted a batch larger than its 50-row bound';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL;
    END;

    SELECT pg_catalog.count(*)::INTEGER INTO v_returned_count
      FROM public.follow_up_email_outbox
     WHERE organization_id = v_org_b AND status = 'QUEUED';
    IF v_returned_count <> 1 THEN
      RAISE EXCEPTION 'FAIL: an organization-scoped claim changed another organization queue';
    END IF;
    SELECT pg_catalog.count(*)::INTEGER INTO v_returned_count
      FROM public.claim_follow_up_reminder_emails(v_org_b, 50);
    IF v_returned_count <> 1 THEN
      RAISE EXCEPTION 'FAIL: the matching organization could not claim its own eligible reminder';
    END IF;

    -- Deleting the organization cascades its leads. The lead-delete trigger
    -- advances a refresh cursor whose organization FK must still be valid.
    -- Keep one deliberately tenant-mismatched outbox fixture whose follow-up
    -- and recipient belong to org A, so its removal below specifically proves
    -- the outbox's organization_id ON DELETE CASCADE rather than another FK.
    INSERT INTO public.follow_up_email_outbox (
      organization_id, follow_up_id, recipient_profile_id, milestone,
      recipient_email, subject, text_body, html_body
    ) VALUES (
      v_org_b, v_f_active, v_active, 'OWNER_ESCALATION',
      v_active_email, 'Cascade fixture', 'Fixture only', '<p>Fixture only</p>'
    );
    DELETE FROM public.leads WHERE organization_id = v_org_b;
    IF EXISTS (SELECT 1 FROM public.follow_up_email_outbox WHERE follow_up_id = v_f_org_b) THEN
      RAISE EXCEPTION 'FAIL: deleting an organization lead did not cascade its follow-up reminder history';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.follow_up_email_outbox WHERE organization_id=v_org_b
         AND follow_up_id=v_f_active AND recipient_profile_id=v_active) THEN
      RAISE EXCEPTION 'FAIL: organization-cascade fixture did not survive unrelated parent cleanup';
    END IF;
    DELETE FROM public.organizations WHERE id = v_org_b;
    IF EXISTS (SELECT 1 FROM public.follow_up_email_outbox WHERE organization_id = v_org_b) THEN
      RAISE EXCEPTION 'FAIL: deleting an organization did not cascade its reminder history';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
      'public.claim_follow_up_reminder_emails(uuid,integer)'::pg_catalog.regprocedure
    ) INTO v_definition;
    IF pg_catalog.strpos(v_definition, 'SKIP LOCKED') = 0
       OR pg_catalog.strpos(v_definition, 'FOR SHARE OF g, f, l, a, p') = 0 THEN
      RAISE EXCEPTION 'FAIL: claim RPC does not retain outbox concurrency and authorization-state locks';
    END IF;

  RAISE NOTICE 'PASS: active/verified delivery, disabled/unverified/email/assignment suppression, tenant and lead relationships, organization/follow-up/profile cascades, organization scoping, repeated claims, and SKIP LOCKED structure';
END;
$authorization_test$;

ROLLBACK;
