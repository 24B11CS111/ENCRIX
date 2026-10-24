# Caller enrollment and bridge persistence

This phase adds a server-controlled phone enrollment workflow and service-only schema for the later Twilio conference bridge. It does not create provider calls, implement conference callbacks, or enable the live call-start route.

## Enrollment security

`POST /api/auth/phone-enrollment` accepts `send` and `verify` actions. The authenticated server profile must be active and have the `TELECALLER` role. The endpoint requires a configured Supabase service client, `OTP_SERVER_SECRET`, and live Twilio SMS configuration. It does not use the development SMS capture fallback.

The server normalizes the input to E.164, stores only an HMAC OTP hash, and sends the code through the server-side Twilio Messages API. The database functions serialize sends per profile, enforce a 60-second resend cooldown and five sends per 15 minutes, and consume a code on success, expiration, or the fifth failed attempt. Verification and the profile phone/`phone_verified` update happen in one database function transaction. The pending phone number is cleared after consumption. Responses and logs contain no OTP or raw number.

Server-only configuration required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_SERVER_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_PHONE_NUMBER` or `TWILIO_CALLER_ID`. The Twilio account must be permitted to send SMS to the target region. These names must be configured in the server environment; none belongs in a `VITE_` variable.

Possession verification does not establish that Twilio permits a number as a caller ID or that applicable regulatory, consent, or caller-identification requirements are satisfied. The planned bridge must use the configured Twilio number as its caller ID unless provider policy explicitly verifies another caller ID.

## Schema and migration ordering

The additive migration is `supabase/migrations/20261023120000_secure_caller_enrollment_bridge_persistence.sql`. It depends on the baseline `organizations`, `profiles`, `calls`, and `webhook_events` objects, plus `profiles.phone_verified` from migration `20261007000000`. It must be applied after the repository's existing migrations through `20261023000000_billing_foundation.sql`, in timestamp order, only after a fresh migration-history and schema preflight.

The migration adds:

- `caller_phone_enrollments`, with a profile/organization composite foreign key, one-pending-enrollment constraint, and service-role-only grants/RLS.
- `begin_caller_phone_enrollment` and `complete_caller_phone_enrollment`, callable only by `service_role`.
- A profile trigger rejecting authenticated changes to `phone` and `phone_verified`. The completion function is server-only and updates both fields atomically after the server verifies the HMAC.
- `call_bridges`, with tenant/call/telecaller composite foreign keys, per-telecaller idempotency uniqueness, unique provider-leg SIDs and conference ID, constrained state fields, timestamps, and service-role-only grants/RLS.
- A `webhook_events.call_sid` index for later provider-event correlation; `webhook_events.provider_event_id` is already unique in migration `20261006000000`.

No database execution is asserted by this document. The local database must apply the full migration chain before validating PostgreSQL behavior. Production history is not assumed to include any pending migration.

## Rollout and recovery

Deploying the endpoint before its migration is safe in the sense that missing RPC/table errors return a generic `503`; do not enable enrollment until the migration has been applied and verified in the target environment. Live call dispatch remains `503` in every environment.

For rollback, disable the enrollment route first and retain the schema and verified profile data. Do not drop the enrollment or bridge tables after use: bridge rows may be needed for webhook correlation or incident recovery, and a rollback must not erase valid phone ownership records. A destructive schema rollback requires a reviewed export and explicit operational approval; no such rollback is claimed here.

## Next bridge phase

Before activation, the next phase must implement caller-first Twilio leg creation, customer leg creation only after the verified caller answers, conference lifecycle and cleanup, signed webhook correlation, monotonic leg/call state transitions, duplicate/out-of-order handling, idempotent retry rules, and recovery for ambiguous provider responses. It must keep provider SIDs inside `call_bridges`, keep customer phone values out of browser responses and logs, and leave live dispatch disabled until end-to-end sandbox testing passes.
