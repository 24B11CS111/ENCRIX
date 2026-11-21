# Caller enrollment and bridge persistence

The caller enrollment migration adds a server-controlled phone ownership workflow and private bridge persistence. The new local Twilio engine uses each organization's encrypted account credentials. No provider calls occur until the organization credentials, database migration and server `TWILIO_CALLING_ENABLED` gate are configured.

## Enrollment security

`POST /api/auth/phone-enrollment` accepts `send` and `verify` actions. The authenticated server profile must be active and have the `TELECALLER` role. The endpoint requires a configured Supabase service client, `OTP_SERVER_SECRET`, and the organization's stored Twilio credentials. It does not use the development SMS capture fallback or a shared ENCRIX Twilio account.

The server normalizes the input to E.164, stores only an HMAC OTP hash, and sends the code through the server-side Twilio Messages API. The database functions serialize sends per profile, enforce a 60-second resend cooldown and five sends per 15 minutes, and consume a code on success, expiration, or the fifth failed attempt. Verification and the profile phone/`phone_verified` update happen in one database function transaction. The pending phone number is cleared after consumption. Responses and logs contain no OTP or raw number.

Server-only configuration required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_SERVER_SECRET`, `TWILIO_CREDENTIAL_ENCRYPTION_KEYS`, and `TWILIO_CREDENTIALS_ACTIVE_KEY_ID`. Each organization owner supplies their own Twilio Account SID, Auth Token and phone number through the protected owner settings API. The Auth Token and Account SID are AES-256-GCM encrypted with organization ID as authenticated additional data; the public Twilio phone number is kept separately for incoming routing. All organizations' Twilio keys remain server-side and none belongs in a `VITE_` variable.

Possession verification does not establish that Twilio permits a number as a caller ID or that applicable regulatory, consent, or caller-identification requirements are satisfied. The planned bridge must use the configured Twilio number as its caller ID unless provider policy explicitly verifies another caller ID.

## Schema and migration ordering

The caller enrollment migration is `supabase/migrations/20261023120000_secure_caller_enrollment_bridge_persistence.sql`. The new organization-specific calling migration is `supabase/migrations/20261031160000_organization_twilio_calling.sql`; it depends on `organizations`, `profiles.phone_verified`, `leads`, `calls`, `call_bridges`, `activity_logs`, and `webhook_events`. Apply migrations only in timestamp order after an exact schema/history preflight. The database remains unverified here because local PostgreSQL was unavailable.

The migration adds:

- `caller_phone_enrollments`, with a profile/organization composite foreign key, one-pending-enrollment constraint, and service-role-only grants/RLS.
- `begin_caller_phone_enrollment` and `complete_caller_phone_enrollment`, callable only by `service_role`.
- A profile trigger rejecting authenticated changes to `phone` and `phone_verified`. The completion function is server-only and updates both fields atomically after the server verifies the HMAC.
- `call_bridges`, with tenant/call/telecaller composite foreign keys, per-telecaller idempotency uniqueness, unique provider-leg SIDs and conference ID, constrained state fields, timestamps, and service-role-only grants/RLS.
- The 20261031160000 migration adds the encrypted organization Twilio account table, service-only RPCs for authorized outbound preparation, idempotent answered-caller claims, inbound phone-to-tenant/lead resolution, and a PII-free inbound failure ledger.
- A `webhook_events.call_sid` index for later provider-event correlation; `webhook_events.provider_event_id` is already unique in migration `20261006000000`.

No database execution is asserted by this document. The local database must apply the full migration chain before validating PostgreSQL behavior. Production history is not assumed to include any pending migration.

## Rollout and recovery

Deploying the endpoint before its migration is safe in the sense that missing RPC/table errors return a generic `503`; do not enable enrollment until the migration has been applied and verified in the target environment. Live call dispatch remains `503` in every environment.

For rollback, set `TWILIO_CALLING_ENABLED=false` and revoke the affected organization's Twilio configuration through the owner API. Retain the schema and verified profile data. Do not drop enrollment, credential, attempt or bridge tables after use: call rows and bridge rows may be needed for webhook correlation and incident recovery. A destructive schema rollback requires a reviewed export and explicit operational approval; do not cascade-delete historical call data.

## Validation still required

The local source now creates the telecaller leg, starts the lead leg only after an authenticated Twilio callback says the caller answered, bridges both through a conference, supports owner-initiated inbound routing to the lead's current verified assignee, and validates per-organization signatures. Before setting `TWILIO_CALLING_ENABLED=true`, execute the migration and SQL tests on disposable PostgreSQL, then exercise the REST and callback flows against each organization's Twilio Test Account. Verify idempotency, provider timeouts, missed/busy calls, reassignment during an active call, callback replay and actual tenant account separation. Recordings are not enabled by default; the migration stores consent false and the engine does not add a recording directive to TwiML.

Incoming-number setup is not changed through the API. For each organization's Twilio number, configure its Voice webhook in that customer's Twilio Console to `https://<deployment-origin>/api/telephony/voice` using HTTP POST. The deployment origin must match `TWILIO_PUBLIC_WEBHOOK_BASE_URL`. Do not use one organization's webhook credential or number for another organization. Inbound routing fails closed unless the called E.164 number resolves to exactly one active organization configuration and the caller matches exactly one assigned lead with an active, verified telecaller.
