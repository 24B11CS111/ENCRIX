# Reviewed billing candidate migrations

These are review artifacts, not authorization to execute in Production. The
five original candidate files are:

1. `20261023000000_billing_foundation_candidate.sql`
2. `20261030000000_owner_business_billing_details_candidate.sql`
3. `20261031000000_onboarding_billing_integrity_candidate.sql`
4. `20261031170000_razorpay_atomic_subscription_lifecycle_candidate.sql`
5. `20261031180000_paid_subscription_entitlement_gate_candidate.sql`

Candidate 230 narrows billing-table privileges granted to `service_role`
instead of granting `ALL`. Candidate 300 adds a same-name index-definition
preflight and normalizes email with `LOWER(BTRIM(email))`. Candidate 310 adds
the durable OTP attempt timestamp and rolling-window send limit. Candidate
1700 only activates a local subscription when Razorpay reports `active` and
there is a verified captured payment in the current period. These are
intentional candidate corrections; the historical `supabase/migrations/`
files remain unchanged.

The separately named forward migrations in `supabase/migrations/` preserve the
same fixes for deployments where earlier candidate effects may already exist:

- `20261105130000_razorpay_failed_refund_transition.sql`
- `20261105140000_paid_entitlement_provider_identity.sql`
- `20261105150000_razorpay_active_subscription_required.sql`
- `20261105160000_registration_otp_send_rate_limit.sql`
- `20261106100000_admin_refund_management.sql` (depends on `20261105170000`; see administrator refund management below)

Historical PGlite 0.5.15 (PostgreSQL 18.6, 32-bit WASM) checks used a synthetic
base application schema and a local `uuid_generate_v4()` shim because PGlite
does not bundle `uuid-ossp`. Separately, on 2026-11-06, the ordered billing and
refund migration sequence (`20261023000000`, `20261030000000`,
`20261031000000`, `20261031170000`, `20261031180000`, `20261105130000`,
`20261105140000`, `20261105150000`, `20261105170000`, and `20261106100000`)
was applied to an isolated native PostgreSQL 17.11 cluster initialized under
session state, using a synthetic application baseline. The paid-entitlement
and atomic subscription lifecycle SQL regression fixtures passed and rolled
back their test data. These are native-engine checks of the selected sequence,
not validation against the full Supabase schema or Production. Run the complete
migration set and fixtures against a restored, disposable PostgreSQL 17
environment before deployment. Run the read-only Production preflight and
reconcile existing catalog state before requesting human approval. Never
blindly retry migrations or manually change Production migration history.


## Second-stage audit notes

- The annual Business catalog item is ₹9,999 (999900 paise). The one-time ₹10,000 onboarding fee is deferred and is not payable or included in checkout.
- Partial-refund entitlement is decided by an administrator: retain only when explicitly approved and reconciled; revoke, unreviewed or unmatched partial refunds fail closed. Full refunds exclude entitlement.
- The reviewed 300 candidate now uses `LOWER(BTRIM(email))` to match application email normalization and fails closed if a same-named existing index has a different expression. The production preflight duplicate check uses the same normalization. This candidate change does not rewrite stored addresses.
- The 310 candidate contains the registration OTP send cap that is also present in migration `20261105160000`; reconcile effects before selecting one path and never blindly apply both.
- The production preflight and postflight scripts are wrapped in `BEGIN TRANSACTION READ ONLY` / `ROLLBACK`. The postflight exposes only aggregate anomaly counts.
- The native PostgreSQL 17.11 run used only an isolated synthetic baseline; full Supabase-schema validation, Razorpay Test Mode, backup restoration, and Production read-only inspection remain outstanding. Historical PGlite results are not native PostgreSQL or Supabase evidence.


## Approved billing policy forward migration

`20261105170000_billing_refund_cancellation_workflows_candidate.sql` is a forward-only candidate after the billing foundation, owner-business details, onboarding integrity, atomic lifecycle, paid entitlement gate, and any required provider/refund corrections. It adds a service-only refund request/review audit model and the period-end cancellation RPCs/state. The source forward migration is `supabase/migrations/20261105170000_billing_refund_cancellation_workflows.sql`. Do not edit earlier historical migrations to apply these policies.

The annual subscription remains ₹9,999. The ₹10,000 onboarding fee is deferred and is neither shown as payable nor included in the provider checkout. Owners can request refund review but cannot approve. An active global ADMIN records the decision and amount; the RPC locks the payment and checks remaining refundable balance including pending/approved reservations. Pending review does not change payment or entitlement. Approved partial refund entitlement requires the administrator to explicitly choose retain; revoke or unreviewed/mismatched partial refunds fail closed. Full refunds are ineligible.

Owner cancellation calls Razorpay's documented `POST /v1/subscriptions/:id/cancel` with `cancel_at_cycle_end: true`. The application persists `scheduled` only after validating the provider response; uncertain network outcomes remain pending for reconciliation. Paid access remains until the stored period end. Razorpay documents this endpoint and the `cancel_at_cycle_end` request field at [Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription).

The cancellation response must also report `has_scheduled_changes = true` and `change_scheduled_at` equal to `current_end`. A provider client error triggers a state read before the request is failed; if the prior attempt was accepted, it is confirmed from the provider state, while uncertain state stays pending. Lifecycle updates preserve terminal subscription states and refuse entitlement renewal from a verified payment at or after the cancellation boundary. Duplicate final refund webhooks reconcile idempotently against the already-recorded provider refund and payment totals.

Razorpay refund submission uses server-held test credentials, an administrator-approved amount, stable request identity, and Razorpay's `X-Refund-Idempotency` header. Refund state is finalized from authenticated provider events and provider fetches, not client claims. No refund or cancellation provider tests have been run.

## Administrator refund management

`/admin/refunds` is guarded by the existing ADMIN route gate and linked from the desktop sidebar and mobile administrator navigation. The backend independently resolves the active profile for each queue, detail, and review operation; owner and telecaller roles are denied. The existing global `ADMIN` role is used; no role is invented. The server verifies the active profile from Supabase, while the existing profile-protection trigger prevents self-elevation and limits `grant_platform_admin(uuid)` to `service_role`. `GET /api/billing/refund-requests` provides backend-authorized global counts and a paginated queue, `GET /api/billing/refund-detail?id=…` returns request/payment/subscription context and review/provider audit history, and `POST /api/billing/refund-review` records an approve/reject decision and, for approval, initiates or resumes provider processing. `POST /api/billing/refund-request` remains owner-only and does not change entitlement.

Every review requires a decision reason. The database review RPC checks the active ADMIN profile, prevents self-review, locks the payment, validates captured/signature evidence, enforces amount reservations, and persists reviewer, amount, and entitlement action. Full refunds require entitlement revocation. Partial refunds require an explicit retain/revoke choice; only reconciled partial refunds saved as `retain` preserve paid access. Provider claims use a short lease and an operation token; Razorpay receives the stable refund request UUID as idempotency key. Any active ADMIN can resume the same saved approval after a lease expires; the amount and entitlement choice cannot change during recovery. Ambiguous outcomes remain processing and must be reconciled; an accepted HTTP response is not considered a completed refund, and a provider API response alone is not logged as refund completion. Audit events are service-role only and ordinary users cannot edit or read them.

The forward-only migration `20261106100000_admin_refund_management.sql` requires the 051700 refund/cancellation workflow migration. Its review artifact is `docs/sql/candidate_migrations/20261106100000_admin_refund_management_candidate.sql`. Apply neither artifact remotely without the separate migration approval and validation process.

Automated authorization/provider behavior has local Vitest coverage. The selected billing/refund migrations and entitlement/lifecycle SQL fixtures pass on an isolated native PostgreSQL 17.11 synthetic baseline; full Supabase-schema validation and Razorpay Test Mode remain outstanding.

Required before any staging/Production application: fresh catalog/conflict preflight; restore-tested backup; native PostgreSQL 17.11 full-chain, failure/rollback and RLS/ACL tests; Razorpay Test Mode cancellation/refund/webhook idempotency tests; restricted administrator operational flow review. This candidate is not approved to execute against any remote database.
