-- Migration 20261101100000 behavioral regression. Fixtures are rolled back.
BEGIN;

DO $pending_invitation_unique_test$
DECLARE
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_profile_a uuid := gen_random_uuid();
  v_profile_b uuid := gen_random_uuid();
  v_duplicate_blocked boolean := false;
  v_index oid;
  v_expr text;
  v_predicate text;
BEGIN
  SELECT i.indexrelid, pg_get_expr(i.indexprs,i.indrelid), pg_get_expr(i.indpred,i.indrelid)
    INTO v_index,v_expr,v_predicate
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
   WHERE i.indrelid='public.organization_invitations'::regclass
     AND idx.relname='organization_invitations_pending_org_email_uidx';
  IF v_index IS NULL OR NOT (SELECT indisunique AND indisvalid AND indisready
        AND indnatts=2 AND indnkeyatts=2 AND indpred IS NOT NULL
        FROM pg_index WHERE indexrelid=v_index)
     OR (SELECT indkey[0] FROM pg_index WHERE indexrelid=v_index) <>
        (SELECT attnum FROM pg_attribute WHERE attrelid='public.organization_invitations'::regclass AND attname='organization_id')
     OR (SELECT indkey[1] FROM pg_index WHERE indexrelid=v_index) <> 0
     OR regexp_replace(lower(v_expr),'::character varying|::text|\(|\)|"|\s|pg_catalog\.','','g') <> 'lowerbtrimemail'
     OR regexp_replace(lower(v_predicate),'::character varying|::text|\(|\)|"|\s|pg_catalog\.','','g') <> 'status=''pending''andemailisnotnull'
     OR (SELECT indrelid FROM pg_index WHERE indexrelid=v_index) <> 'public.organization_invitations'::regclass THEN
    RAISE EXCEPTION 'FAIL: pending invitation index semantics do not match the migration';
  END IF;
  RAISE NOTICE 'PASS: unique index has the exact organization_id and lower(btrim(email)) pending/non-null predicate';

  INSERT INTO public.organizations(id,name,slug,owner_id)
  VALUES (v_org_a,'Invitation Unique A','migration-200-org-'||v_org_a::text,v_user_a),
         (v_org_b,'Invitation Unique B','migration-200-org-'||v_org_b::text,v_user_b);
  INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  VALUES (v_user_a,'authenticated','authenticated','migration-200-'||v_user_a::text||'@fixture.invalid','',now(),now(),now()),
         (v_user_b,'authenticated','authenticated','migration-200-'||v_user_b::text||'@fixture.invalid','',now(),now(),now());
  INSERT INTO public.profiles(id,user_id,organization_id,full_name,role,status)
  VALUES (v_profile_a,v_user_a,v_org_a,'Migration 200 Test Owner A','OWNER','ACTIVE'),
         (v_profile_b,v_user_b,v_org_b,'Migration 200 Test Owner B','OWNER','ACTIVE');

  -- Same organization plus case/whitespace normalization is unique while pending.
  INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,token,expires_at)
  VALUES (v_org_a,'+10000000001','Pending One','Invitee@Example.test',v_profile_a,
          'migration-200-invite-pending-'||v_org_a::text,now()+interval '1 day');
  BEGIN
    INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,token,expires_at)
    VALUES (v_org_a,'+10000000002','Pending Duplicate','  invitee@example.test  ',v_profile_a,
            'migration-200-invite-duplicate-'||v_org_a::text,now()+interval '1 day');
  EXCEPTION WHEN unique_violation THEN v_duplicate_blocked := true;
  END;
  IF NOT v_duplicate_blocked THEN RAISE EXCEPTION 'FAIL: normalized duplicate pending invitation was accepted'; END IF;
  RAISE NOTICE 'PASS: duplicate normalized pending invite in one organization is rejected';

  -- A second organization may invite the same normalized address independently.
  INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,token,expires_at)
  VALUES (v_org_b,'+10000000003','Other Tenant Invite','invitee@example.test',v_profile_b,
          'migration-200-invite-other-tenant-'||v_org_b::text,now()+interval '1 day');
  RAISE NOTICE 'PASS: same normalized email is independently inviteable by another organization';

  -- Accepted, revoked and explicitly expired rows do not reserve the address.
  INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,status,token,expires_at)
  VALUES (v_org_a,'+10000000004','Accepted Invite','accepted@example.test',v_profile_a,'ACCEPTED',
          'migration-200-invite-accepted-'||v_org_a::text,now()+interval '1 day'),
         (v_org_a,'+10000000005','Revoked Invite','revoked@example.test',v_profile_a,'REVOKED',
          'migration-200-invite-revoked-'||v_org_a::text,now()+interval '1 day'),
         (v_org_a,'+10000000006','Expired Invite','expired@example.test',v_profile_a,'EXPIRED',
          'migration-200-invite-expired-'||v_org_a::text,now()-interval '1 day');
  INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,token,expires_at)
  VALUES (v_org_a,'+10000000007','New Accepted Address','accepted@example.test',v_profile_a,
          'migration-200-invite-new-accepted-'||v_org_a::text,now()+interval '1 day'),
         (v_org_a,'+10000000008','New Revoked Address','revoked@example.test',v_profile_a,
          'migration-200-invite-new-revoked-'||v_org_a::text,now()+interval '1 day'),
         (v_org_a,'+10000000009','New Expired Address','expired@example.test',v_profile_a,
          'migration-200-invite-new-expired-'||v_org_a::text,now()+interval '1 day');
  RAISE NOTICE 'PASS: accepted, revoked and expired invitations do not block new pending invitations';

  -- Timestamp-expired rows remain index members until their state is transitioned.
  INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,token,expires_at)
  VALUES (v_org_a,'+10000000010','Stale Pending','stale@example.test',v_profile_a,
          'migration-200-invite-stale-'||v_org_a::text,now()-interval '1 day');
  UPDATE public.organization_invitations SET status='EXPIRED'
   WHERE organization_id=v_org_a AND status='PENDING' AND expires_at<=now() AND email='stale@example.test';
  INSERT INTO public.organization_invitations(organization_id,phone_number,full_name,email,invited_by,token,expires_at)
  VALUES (v_org_a,'+10000000011','Replacement Stale Address','stale@example.test',v_profile_a,
          'migration-200-invite-stale-replacement-'||v_org_a::text,now()+interval '1 day');
  IF (SELECT count(*) FROM public.organization_invitations WHERE organization_id=v_org_a
        AND lower(btrim(email))='stale@example.test' AND status='PENDING') <> 1 THEN
    RAISE EXCEPTION 'FAIL: expired pending invitation transition did not permit replacement';
  END IF;
  RAISE NOTICE 'PASS: expired pending row can be transitioned and replaced';
END;
$pending_invitation_unique_test$;

ROLLBACK;
