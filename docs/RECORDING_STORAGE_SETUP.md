# Private call-recording Storage setup

The database migration does not create or alter Supabase-managed Storage objects. Set up the bucket separately in the Supabase Dashboard after the recording authorization migration is applied.

## Create or verify the bucket

1. Open **Storage** for the intended Supabase project and select **New bucket**.
2. Use the exact bucket name `call-recordings`.
3. Keep **Public bucket** disabled.
4. Set the maximum file size to `52428800` bytes (50 MiB).
5. Allow only `audio/mpeg`. The server recording pipeline uploads recordings with this content type.
6. If the bucket already exists, do not recreate or delete it. Verify its name, private setting, size limit, and MIME restriction; stop and investigate any mismatch before changing settings.

The server-side recording pipeline uploads to `{organization_uuid}/{call_uuid}.mp3` with the Supabase service-role client. The recording endpoint uses that server-only client to create a 60-second signed URL only after checking the caller's active profile, organization, and (for telecallers) call initiator. Never put the service-role key in browser code.

## Add the client read policy

The Phase 23.7 migration defines `public.can_access_call_recording_path(text)` but intentionally does not issue DDL against the managed `storage.objects` table. In the Dashboard's **Storage → Policies** UI, create or replace the following SELECT policy. If using the SQL Editor, run this only with an authorized project database role:

```sql
DROP POLICY IF EXISTS "Authorized users can read call recordings"
ON storage.objects;

CREATE POLICY "Authorized users can read call recordings"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'call-recordings'
    AND public.can_access_call_recording_path(name)
);
```

The path authorization function accepts only the canonical UUID path and permits active telecallers to read recordings for calls they initiated, owners to read within their organization, and platform admins according to the existing platform-admin policy. It rejects malformed paths and cross-organization owner access.

Do **not** add client INSERT, UPDATE, or DELETE policies. The authenticated clients must not have unrestricted upload or read access; the backend service role performs uploads and signed-URL creation. The read policy is scoped to the exact bucket and authorization function above.

Policy setup is repeatable: the named policy is dropped before it is recreated. If the Dashboard reports insufficient ownership/privileges for `storage.objects`, stop; do not change table ownership, use `ALTER TABLE`, disable RLS, or attempt to modify `storage.buckets`. Resolve the required supported Dashboard/project-role access with the Supabase project administrator instead.
