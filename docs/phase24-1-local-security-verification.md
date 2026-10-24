# Phase 24.1 local database verification

This procedure is for a disposable local Supabase database only. Do not use a
linked project or production credentials. The Phase 24.1 migration is
`20261024100000_phase24_1_security_remediation.sql`.

After Docker is available, run the complete local migration chain:

```powershell
npx supabase db reset --local
npx supabase db lint --local
```

Then verify the call RPC ACL and lead trigger catalog state:

```sql
SELECT
  has_function_privilege('anon', 'public.initiate_authorized_call(uuid)', 'EXECUTE') AS anon_can_call,
  has_function_privilege('authenticated', 'public.initiate_authorized_call(uuid)', 'EXECUTE') AS authenticated_can_call,
  has_function_privilege('service_role', 'public.initiate_authorized_call(uuid)', 'EXECUTE') AS service_role_can_call;

SELECT t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND t.tgrelid IN ('public.profiles'::regclass, 'public.leads'::regclass)
  AND t.tgname IN (
    'trg_prevent_profile_phone_self_update',
    'trg_restrict_telecaller_lead_update_columns'
  );
```

Expected: all three call-RPC privilege results are false; both triggers exist.
Run direct insert/update attempts as a seeded authenticated owner and
telecaller in a rollback-only transaction: inserting a profile with a phone or
`phone_verified = true` and updating either protected profile field must fail;
updating an assigned lead's `status` or `notes` must succeed; changes to phone,
organization, assignment, identity, or other lead columns must fail. Repeat
against an unassigned lead and another tenant; RLS must reject those rows.

There is deliberately no Realtime Broadcast path for call status after this
change. Verify that the webhook handler does not create or publish a Broadcast
channel; ordinary `postgres_changes` consumers remain subject to table RLS.
These catalog and role tests must run on the local database before treating the
database controls as runtime-verified.
