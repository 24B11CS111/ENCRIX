# ENCRIX production schema reconciliation inventory

**Prepared:** 2026-11-01

**Method:** source inspection only; no production connection or SQL execution.
**Scope:** all 33 files in `supabase/migrations/`; versions `20261001000000` and `20261001000001` are reported as recorded by the requester, leaving 31 unrecorded versions.

## Decision and evidence boundary

This is an inventory and a read-only diagnostic, not a production catalog report. The only live facts accepted here are those supplied by the requester: the two recorded versions, 31 unrecorded versions, and absence of `public.organization_subscriptions`, `public.billing_payments`, and `public.organization_has_active_paid_entitlement(uuid)`. Every other production object state is **UNKNOWN** until the SQL Editor script is run by an authorized operator and its output reviewed. An unrecorded migration is not evidence that its effects are missing. No migration is approved for replay or history baselining by this document.

The diagnostic emits `PRESENT`, `MISSING`, `CONFLICTING`, or `UNKNOWN`. Presence checks establish catalog existence only. For function bodies, policy expressions, constraint/index definitions, ownership, grants, RLS flags, and publication column lists, the script prints the catalog definition/metadata needed for source comparison; an object is not considered semantically reconciled merely because its name exists. If required catalog support or prerequisites are absent, the result is `UNKNOWN`, not a script failure.

## All 33 source migrations

The first two are included for chronology/dependency context; the following 31 are the unrecorded migration inventory supplied for reconciliation.

| Version / source file | Source effects to compare against production | Source dependencies / risk notes |
|---|---|---|
| `20261001000000_init_leadvault.sql` | Enables `uuid-ossp` in `extensions`; creates organizations, profiles, leads, lead_assignments, calls, call_outcomes, follow_ups, messages, notifications, activity_logs, security_events, user_sessions; creates the listed organization/lead/call/follow-up/audit/notification indexes; creates `get_auth_profile()`, `get_auth_role()`, `get_auth_org_id()`; enables RLS and creates the initial tenant/role policies. | Base schema. The migration uses `IF NOT EXISTS`; that does not validate an existing object's definition. |
| `20261001000001_security_hardening.sql` | Revokes audit-log mutation; creates `prevent_audit_tampering()` and immutable audit triggers; creates/replaces `mask_phone(text)`, `telecaller_leads_view`, `initiate_authorized_call(uuid)`, and `is_caller_active()`; grants view/function access as stated in source. | Depends on base audit/call/profile/lead objects. Replaces executable behavior and must be body/grant compared. |
| `20261006000000_production_telephony_recordings.sql` | Creates `webhook_events`; enables RLS and service-role policy; replaces `calls_status_check`; defines three `can_access_call_recording` overload/path functions and changes their execute grants. | Requires existing calls and Supabase roles. Function-body/grant replacement is security-sensitive. |
| `20261007000000_otp_authentication_and_onboarding.sql` | Adds `profiles.phone_verified`; replaces profile status check; adds phone indexes; creates `organization_invitations`, `pending_registrations`, `phone_otps`, their indexes, RLS and named policies. | Requires organizations/profiles/auth model. Creates OTP and invitation data stores. |
| `20261008000000_email_otp_authentication.sql` | Adds profile email/email_verified and indexes; creates `email_otps` with lookup/expiry indexes and service-only RLS; relaxes invitation/pending-registration phone nullability; replaces pending-registration phone uniqueness with email uniqueness; adds invitation/pending email indexes. | Requires 070000. Constraint drop/recreate and existing duplicate emails need preflight. |
| `20261012000000_phase17_realtime_crm_telephony.sql` | Creates `call_recordings` with RLS and tenant policy; creates call/lead/security-event/invitation indexes; adds calls, leads, follow_ups and security_events to `supabase_realtime`. | Requires publication and source tables. Publication operations may fail if publication/table state differs. |
| `20261013000000_phase18_secure_student_details_zero_phone.sql` | Adds lead student-detail fields (see source `ALTER TABLE public.leads`); replaces `telecaller_leads_view`; replaces `get_telecaller_student_detail(uuid)` and grants authenticated execution. | Replaces data projection/access logic. Must inspect view/function definition and grants. |
| `20261014000000_phase20_smart_lead_distribution.sql` | Creates `distribution_configs`; adds lead distribution fields and assignment mode fields; creates distribution/open-workload/unassigned/active-assignment indexes; enables RLS and owner/admin policies; inserts default config rows for organizations without one. | Requires profiles/leads/lead_assignments. Includes data writes; existing distributions and cursor values require non-destructive review. |
| `20261015000000_phase21_smart_follow_up_engine.sql` | Alters follow_up status/fields, replaces status constraint; adds scheduled/assigned/active/reminder/overdue indexes; replaces telecaller and owner follow-up policies. | Requires existing follow_ups and policies. Status values and existing rows must satisfy revised checks. |
| `20261018000000_phase22_security_critical_remediation.sql` | Adds profile/pending-registration/lead security fields and indexes; revokes public schema creation/anon access; replaces profile privilege-escalation function/trigger and profile/lead policies; replaces sanitized telecaller view, call-initiation function, student-detail function and execute grants. | Alters broad schema privileges, RLS, view and SECURITY DEFINER behavior. Requires precise privilege/policy/function comparison. |
| `20261019000000_phase22_phone_exposure_remediation.sql` | Sets safer search paths on auth/audit/caller/recording functions; replaces telecaller view and student-detail function. | Function metadata and view/function bodies are changed. |
| `20261020000000_phase23_followup_reminder_concurrency.sql` | Replaces `process_follow_up_reminders_cron(timestamptz,uuid)` with bounded/concurrency-safe behavior and service-role-only execution. | Depends on follow-up, notification and audit structures. SECURITY DEFINER body/grant comparison required. |
| `20261021000000_phase23_7_production_blocker_remediation.sql` | Replaces profile privilege function/trigger; adds service-only `grant_platform_admin(uuid)`; adds restrictive raw-lead telecaller policy; replaces telecaller view/student-detail and reminder processor. | Replaces security behavior from 180/200. Check trigger, RLS mode, owners, function body and ACL. |
| `20261022000000_phase23_8_active_profile_rls.sql` | Creates/replaces `is_active_authenticated_profile()`, and replaces caller/auth profile/role/org helpers with grants; dynamically creates restrictive active-profile policies on RLS-enabled public tables. | Dynamic policy count depends on actual tables/RLS state. Must compare each policy/table pair, not just the helper. |
| `20261023000000_billing_foundation.sql` | Creates `organization_subscriptions`, `billing_payments`, `billing_webhook_events`; creates current-subscription/status-period and payment chronology indexes; enables RLS, revokes client/PUBLIC table access, grants `service_role` and creates service-only policies. | Requires organizations, `extensions.uuid_generate_v4()` and Supabase roles. Requester confirms first two billing tables missing; webhook table remains unknown. |
| `20261023120000_secure_caller_enrollment_bridge_persistence.sql` | Adds profile composite-unique index; creates `caller_phone_enrollments` and `call_bridges`; adds enrollment/call-bridge/webhook indexes; enables RLS/service-only grants; defines begin/complete enrollment, phone-update guard and trigger; adds unique calls identity index. | Requires profiles/calls/webhook_events. Existing same-name constraints/indexes and identity duplicates need check. |
| `20261024100000_phase24_1_security_remediation.sql` | Revokes `initiate_authorized_call(uuid)` access; replaces phone self-update protection and telecaller lead-column guard and trigger. | Requires prior call/phone policy implementation. Stored and effective grants must be checked. |
| `20261024120000_phase24_3_secure_telecaller_lead_access.sql` | Reasserts authenticated access to sanitized view; creates/replaces `update_assigned_telecaller_lead(uuid,text,text)` with execute grants. | Depends on telecaller view and assignment schema. Check function body/grants. |
| `20261024130000_phase24_7_server_telecaller_leads.sql` | Creates/replaces `server_get_assigned_telecaller_leads(uuid,uuid,uuid)` and `server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)`; service-role-only execution. | Depends on profiles/leads. SECURITY DEFINER functions must be tenant/assignment/body compared. |
| `20261027000000_phase32_realtime_publications.sql` | Adds profiles and organization_invitations to `supabase_realtime` conditionally. | Requires publication/tables; inspect publication membership and column lists. |
| `20261028000000_phase33_realtime_notifications.sql` | Adds notifications to `supabase_realtime`; changes notifications replica identity to FULL. | Requires notifications/publication. Inspect replica identity and publication. |
| `20261030000000_owner_business_billing_details.sql` | Adds business-details fields to organizations and pending registrations; creates unique lower(profile email) and organization owner indexes. | Depends on organizations/profiles/pending_registrations. Duplicate email/owner data can block unique indexes. |
| `20261030120000_owner_csv_import_persistence.sql` | Adds normalized-phone and import-marker lead indexes; creates `guard_org_lead_phone_write()` trigger and `create_owner_lead(...)`/`import_owner_leads(...)` SECURITY DEFINER RPCs, service-only. RPCs perform lead/assignment/audit/notification writes. | Depends on leads, profiles, distribution configs, assignments, logs and notifications. Existing trigger/index/function conflicts and normalized-phone duplicate counts need review. |
| `20261031000000_onboarding_billing_integrity.sql` | Creates/extends `registration_otp_attempts`; adds pending-registration OTP ticket; creates/replaces issue/status/complete/cancel registration OTP RPCs and transactional `create_owner_registration(...)`; removes legacy failure RPC; creates payment identity trigger/function; adds amount-required, payment-subscription-required and payment-timestamp constraints. | Depends on 300000, 230000, registration tables, profiles, organizations and billing data. Existing rows are scanned by constraints; security-sensitive registration behavior changes. |
| `20261031120000_sanitized_lead_refresh_signals.sql` | Creates `lead_refresh_signals` with organization/profile cursor columns; unique organization/profile cursor indexes; RLS and owner/admin organization + telecaller-self policies; grants authenticated SELECT/service-role operations per source; creates bump/emit functions and lead trigger; removes raw leads from publication and adds only signal columns. | Requires profiles/leads and `supabase_realtime`. Compare policies/function bodies and exact publication column list; no raw leads publication restoration is safe fallback. |
| `20261031130000_public_leads_privilege_hardening.sql` | Revokes leads table ACL from PUBLIC/anon/authenticated/service_role then grants service_role SELECT and column UPDATE on assigned_to/status/updated_at/priority/notes; changes `initiate_authorized_call` privilege; replaces student-detail function; restricts postgres public-schema default table/sequence/function ACLs. | Requires lead privilege contract and function dependencies. Also has default ACL preflight; compare stored and effective ACL including PostgreSQL 17 MAINTAIN. |
| `20261031140000_security_definer_search_path_hardening.sql` | Alters search_path metadata on eight SECURITY DEFINER functions: begin/complete caller enrollment, 2 recording access overloads, recording-path access, legacy student detail, caller-active, telecaller lead-column guard. | Metadata-only source operation. Verify signatures, owner, SECURITY DEFINER, exact proconfig, stored/effective grants. |
| `20261031150000_durable_email_otp_attempts.sql` | Adds durable ticket metadata to email_otps and a partial unique ticket-id index; defines issue/complete/cancel email OTP ticket RPCs; restricts execution to service_role. | Requires 080000 email_otps schema and uuid-ossp. Duplicate ticket IDs or incompatible columns/index conflict are blockers. |
| `20261031160000_organization_twilio_calling.sql` | Creates organization_twilio_credentials and telephony_inbound_attempts; adds active-phone and call provider/idempotency indexes; alters call_bridges state/flow constraints and adds flow; adds lead inbound index; creates seven Twilio configuration/outbound/inbound RPCs, service-role only; RLS/service-only table access. | Requires caller enrollment/call bridge/calls/leads/profiles and encryption key IDs. Existing call constraints/data and provider IDs must be checked. No provider operation is part of SQL. |
| `20261031170000_razorpay_atomic_subscription_lifecycle.sql` | Adds payment refunded amount and subscription total_count; adds validated refund/positive-count/status constraints; creates verified-subscription-period index; defines `apply_verified_razorpay_payment(...)` SECURITY DEFINER RPC and service-role-only execution. | Requires 230000/310000. Existing refund/status/period data can block checks; function has payment/subscription side effects and explicit transaction control. |
| `20261031180000_paid_subscription_entitlement_gate.sql` | Defines `organization_has_active_paid_entitlement(uuid)` SECURITY DEFINER/STABLE with `pg_catalog, pg_temp`; only active, current, valid-period Business ₹9,999/year, captured INR signature-verified payment with non-full refund grants; service-role-only execute. | Requires billing foundation, 310000 and 170000. User confirms function and two core billing tables absent; all other prerequisites unknown. |
| `20261101090000_followup_email_outbox.sql` | Creates follow_up_email_outbox, RLS/no client access; defines queue/claim/complete reminder outbox RPCs, service-role-only; uses claim locking and claim tokens; validates current recipient/follow-up authorization at claim time. | Requires follow_up/profile/org tables and relationships. Existing auth relationships and duplicate outbox rows need review; ON DELETE cascades affect retained history. |
| `20261101100000_unique_pending_invitations.sql` | Duplicate preflight, then unique partial index on `(organization_id, lower(btrim(email))) WHERE status='PENDING' AND email IS NOT NULL`. | Requires organization_invitations. Aggregate duplicate count is safe to inspect; no rows are changed by this migration. |

### Unrecorded version reconciliation status

All 31 rows below have **history state: unrecorded (requester-supplied)**. Their full schema state is **UNKNOWN** pending the diagnostic. The three absences supplied by the requester are separately reflected as confirmed missing object facts; they do not prove the complete 230000/310000/311800 migration effects are absent.

| # | Version | Migration | Production reconciliation result |
|---:|---|---|---|
| 1 | 20261006000000 | production_telephony_recordings | UNKNOWN |
| 2 | 20261007000000 | otp_authentication_and_onboarding | UNKNOWN |
| 3 | 20261008000000 | email_otp_authentication | UNKNOWN |
| 4 | 20261012000000 | phase17_realtime_crm_telephony | UNKNOWN |
| 5 | 20261013000000 | phase18_secure_student_details_zero_phone | UNKNOWN |
| 6 | 20261014000000 | phase20_smart_lead_distribution | UNKNOWN |
| 7 | 20261015000000 | phase21_smart_follow_up_engine | UNKNOWN |
| 8 | 20261018000000 | phase22_security_critical_remediation | UNKNOWN |
| 9 | 20261019000000 | phase22_phone_exposure_remediation | UNKNOWN |
| 10 | 20261020000000 | phase23_followup_reminder_concurrency | UNKNOWN |
| 11 | 20261021000000 | phase23_7_production_blocker_remediation | UNKNOWN |
| 12 | 20261022000000 | phase23_8_active_profile_rls | UNKNOWN |
| 13 | 20261023000000 | billing_foundation | UNKNOWN; `organization_subscriptions` and `billing_payments` confirmed MISSING; `billing_webhook_events` UNKNOWN |
| 14 | 20261023120000 | secure_caller_enrollment_bridge_persistence | UNKNOWN |
| 15 | 20261024100000 | phase24_1_security_remediation | UNKNOWN |
| 16 | 20261024120000 | phase24_3_secure_telecaller_lead_access | UNKNOWN |
| 17 | 20261024130000 | phase24_7_server_telecaller_leads | UNKNOWN |
| 18 | 20261027000000 | phase32_realtime_publications | UNKNOWN |
| 19 | 20261028000000 | phase33_realtime_notifications | UNKNOWN |
| 20 | 20261030000000 | owner_business_billing_details | UNKNOWN |
| 21 | 20261030120000 | owner_csv_import_persistence | UNKNOWN |
| 22 | 20261031000000 | onboarding_billing_integrity | UNKNOWN |
| 23 | 20261031120000 | sanitized_lead_refresh_signals | UNKNOWN |
| 24 | 20261031130000 | public_leads_privilege_hardening | UNKNOWN |
| 25 | 20261031140000 | security_definer_search_path_hardening | UNKNOWN |
| 26 | 20261031150000 | durable_email_otp_attempts | UNKNOWN |
| 27 | 20261031160000 | organization_twilio_calling | UNKNOWN |
| 28 | 20261031170000 | razorpay_atomic_subscription_lifecycle | UNKNOWN |
| 29 | 20261031180000 | paid_subscription_entitlement_gate | UNKNOWN; entitlement RPC confirmed MISSING |
| 30 | 20261101090000 | followup_email_outbox | UNKNOWN |
| 31 | 20261101100000 | unique_pending_invitations | UNKNOWN |

## Exact table shape changes from source

For created tables, these are the source-defined columns (in declaration order); constraints and indexes are listed in the migration inventory above and remain subject to exact catalog comparison. The migration file is authoritative for nullability, defaults, checks, and FK details.

| Version | Created-table columns / altered existing columns |
|---|---|
| 060000 | `webhook_events`: `id uuid`, `provider varchar(50)`, `provider_event_id varchar(150)`, `call_sid varchar(150)`, `event_type varchar(50)`, `payload jsonb`, `processed_at timestamptz`, `created_at timestamptz`. |
| 070000 | `organization_invitations`: `id`, `organization_id`, `phone_number`, `full_name`, `email`, `invited_by`, `role`, `status`, `token`, `expires_at`, `created_at`; `pending_registrations`: `id`, `phone_number`, `company_name`, `owner_name`, `email`, `industry`, `company_size`, `otp_hash`, `attempts`, `resend_after`, `expires_at`, `created_at`; `phone_otps`: `id`, `phone_number`, `purpose`, `otp_hash`, `attempts`, `resend_after`, `expires_at`, `used`, `created_at`. Types, defaults and constraints are defined exactly in 070000. Adds `profiles.phone_verified boolean NOT NULL DEFAULT false`. |
| 080000 | `email_otps`: `id uuid`, `email varchar(255)`, `purpose varchar(50)`, `otp_hash varchar(255)`, `attempts integer`, `resend_after/expires_at/created_at timestamptz`, `used boolean`; adds profile `email varchar(255)` and `email_verified boolean NOT NULL DEFAULT false`; makes invitation/pending `phone_number` nullable; replaces pending-registration phone/email uniqueness with unique email. |
| 120000 | `call_recordings`: `id uuid`, `organization_id uuid`, `call_id uuid`, `provider varchar(50)`, `provider_recording_id varchar(150)`, `storage_path text`, `duration_seconds integer`, `status varchar(50)`, `created_at/updated_at timestamptz`. |
| 130000 | Adds leads fields: `father_name`, `mother_name varchar(255)`; `neet_score`, `neet_rank`, `neet_year`, `neet_attempts`, `eamcet_score`, `eamcet_rank`, `eamcet_year`, `eamcet_attempts`, `ipe_marks`, `ipe_year`, `ipe_attempts integer`; `ipe_percentage numeric(5,2)`; `category`, `gender varchar(50)`; `city`, `state varchar(100)`; `school_or_college`, `course_interest varchar(255)`. |
| 140000 | Adds leads `unassigned_reason varchar(100)`, `reassigned_at timestamptz`, `reassign_reason text`; lead_assignments `reassign_reason text`, `previous_user_id uuid`, `mode varchar(50)`. Creates `distribution_configs` (exact definition in 140000). |
| 150000 | Adds follow_ups `created_by uuid`, `timezone varchar(100)`, `reason text`, `completed_at timestamptz`, `outcome varchar(100)`, `outcome_notes text`, `rescheduled_at timestamptz`, `reschedule_reason text`, `previous_due_at timestamptz`, `reschedule_count integer NOT NULL DEFAULT 0`, `reminded_at`, `overdue_notified_at`, `owner_alerted_at`, `escalated_at timestamptz`, `escalated_by uuid`, `escalation_reason text`. |
| 180000 | Adds profile `email varchar(255)` if absent; pending-registration unique email constraint; leads `last_contacted_at timestamptz`, `calls_count integer NOT NULL DEFAULT 0`. |
| 230000 | Creates `organization_subscriptions`, `billing_payments`, `billing_webhook_events`; exact source columns include subscription plan/status/entitlement/idempotency/amount/provider IDs/period and lifecycle timestamps; payment org/subscription/provider/idempotency/order/payment/invoice/amount/currency/status/verification and lifecycle timestamps; webhook provider/event/hash/state/timestamp fields. Exact per-column types, defaults, nullability and constraints are in 230000 and are printed from actual catalogs by the diagnostic. |
| 231200 | Creates `caller_phone_enrollments` (id/org/profile/phone/OTP hash/attempts and lifecycle timestamps) and `call_bridges` (call/org/telecaller/idempotency/conference IDs, call states, provider SIDs, leg states/timestamps, recovery/failure fields and lifecycle timestamps). Exact types, checks and FKs are in 231200. |
| 300000 | Adds organizations and pending_registrations `business_email varchar(255)`, `business_phone varchar(50)`, `business_location varchar(500)`, `website_url text`. |
| 310000 | Creates `registration_otp_attempts(ticket_id uuid,email text,otp_hash text,attempts smallint,verified_at timestamptz,consumed_at timestamptz,expires_at timestamptz)`; may add `otp_hash`, `verified_at`, and pending-registration `otp_ticket_id uuid`. |
| 311200 | Creates `lead_refresh_signals(id bigint identity,organization_id uuid,recipient_profile_id uuid,revision bigint,updated_at timestamptz)`. Publication should include only approved signal columns after removing raw leads. |
| 311500 | Adds `email_otps.ticket_id uuid` and `verified_at timestamptz`. |
| 311600 | Creates `organization_twilio_credentials(organization_id,twilio_phone_number,key_id,nonce,ciphertext,auth_tag,status,updated_by,created_at,updated_at)` and `telephony_inbound_attempts(id,organization_id,provider_call_sid,outcome,created_at)`; adds `call_bridges.flow text NOT NULL DEFAULT 'OUTBOUND'`. |
| 311700 | Adds `billing_payments.amount_refunded_paise bigint NOT NULL DEFAULT 0`; adds `organization_subscriptions.razorpay_total_count integer`. |
| 20261101090000 | Creates `follow_up_email_outbox(id,organization_id,follow_up_id,recipient_profile_id,milestone,recipient_email,subject,text_body,html_body,status,attempts,claim_token,created_at,claimed_at,sent_at,provider_message_id,failure_code)`. |
| Other unrecorded versions | No new table columns unless stated above; their effects are primarily function/view/security/trigger/index/policy/publication changes listed in each source migration. |

## Named source objects (indexes, functions, triggers, policies)

Names below are extracted from migration statements. Full bodies, predicate expressions, exact ACL grantees, constraint check expressions, and publication column lists are defined in their source SQL; the diagnostic prints the actual catalog text for direct comparison. Name-only matches are not classified as semantic matches.

| Version | Indexes / constraints | Functions, triggers, policies and publication changes |
|---|---|---|
| 060000 | `calls_status_check`; `webhook_events_provider_event_id` is inline unique | `can_access_call_recording(uuid,uuid)`, `can_access_call_recording(uuid)`, `can_access_call_recording_path(text)`; webhook service policy. |
| 070000 | `idx_profiles_phone`, `idx_profiles_phone_verified`, `idx_org_invitations_org_status`, `idx_org_invitations_token`, `idx_org_invitations_phone`, `idx_pending_reg_phone`, `idx_pending_reg_expires`, `idx_phone_otps_phone_purpose`, `idx_phone_otps_expires` | Invitation admin/owner/telecaller/service policies; pending-registration and phone-OTP service-only policies. |
| 080000 | `idx_profiles_email`, `idx_profiles_email_verified`, `idx_email_otps_lookup`, `idx_email_otps_expires`, `pending_registrations_email_key`, `idx_org_invitations_email`, `idx_pending_reg_email` | Email OTP service-only policy. Drops pending-registration phone/email unique constraints before adding email uniqueness. |
| 120000 | `idx_call_recordings_call_id`, `idx_call_recordings_org_id`, `idx_calls_org_status`, `idx_calls_telecaller`, `idx_leads_org_assigned`, `idx_security_events_org_type`, `idx_organization_invitations_token` | Tenant call-recording policy; publication additions calls, leads, follow_ups, security_events. |
| 130000 | None | `telecaller_leads_view`, `get_telecaller_student_detail(uuid)`. |
| 140000 | `idx_distribution_configs_org`, `idx_leads_open_workload`, `idx_leads_unassigned_queue`, `idx_lead_assignments_lead_active` | Owner/admin distribution view/insert/update policies; inserts default configs. |
| 150000 | `idx_followups_org_status_scheduled`, `idx_followups_assigned_status`, `idx_followups_lead_active`, `idx_followups_pending_reminders`, `idx_followups_pending_overdue_tc`, `idx_followups_pending_overdue_owner` | Replaces owner and telecaller follow-up policies. |
| 180000 | `idx_profiles_email`, `idx_leads_last_contacted`, pending-registration email unique | `protect_profile_privilege_escalation()`, its profile trigger, profile/lead policies, telecaller view, `initiate_authorized_call(uuid)`, `get_telecaller_student_detail(uuid)`; schema and function/view ACL changes. |
| 190000 | None | Search-path changes on auth/audit/caller/recording helpers; replaces telecaller view and student-detail function. |
| 200000 | None | Replaces `process_follow_up_reminders_cron(timestamptz,uuid)`; service-role-only execution. |
| 210000 | None | Replaces profile protection trigger/function, adds `grant_platform_admin(uuid)`, raw-lead restrictive policy, telecaller view/detail and reminder function. |
| 220000 | None | `is_active_authenticated_profile()`, `is_caller_active()`, `get_auth_profile()`, `get_auth_role()`, `get_auth_org_id()`; dynamic restrictive active-profile policy on each RLS-enabled public table. |
| 230000 | `organization_subscriptions_one_current_per_org`, `organization_subscriptions_status_period_end`, `billing_payments_org_created`, `billing_payments_subscription_created`; inline subscription period/order and composite uniqueness/FK and webhook event uniqueness | Three service-role-only RLS policies; revoke PUBLIC/anon/authenticated table ACL and grant ALL to service_role. |
| 231200 | `profiles_id_organization_unique_idx`, `caller_phone_enrollments_profile_created_idx`, `caller_phone_enrollments_one_pending_per_profile_idx`, `calls_id_organization_telecaller_unique_idx`, `call_bridges_org_created_idx`, `webhook_events_call_sid_idx` | Begin/complete phone-enrollment RPCs, profile phone guard/trigger, enrollment and bridge service-only policies/grants. |
| 241000 | None | Replaces phone guard and trigger plus telecaller update-column guard/trigger; revokes call-initiation RPC execution. |
| 241200 | None | `update_assigned_telecaller_lead(uuid,text,text)` and execute/view grants. |
| 241300 | None | Server get/update telecaller lead RPCs; execution revoked from public client roles and granted service_role. |
| 270000 | None | Adds profiles and organization_invitations to Realtime publication. |
| 280000 | None | Adds notifications to publication and sets REPLICA IDENTITY FULL. |
| 300000 | `profiles_email_unique_lower`, `organizations_owner_id_unique` | None. |
| 301200 | `idx_leads_org_normalized_phone`, `idx_leads_csv_import_marker` | `guard_org_lead_phone_write()` and trigger, `create_owner_lead(...)`, `import_owner_leads(...)`; service-role-only RPCs. |
| 310000 | `organization_subscriptions_amount_required`, `billing_payments_subscription_required`, `billing_payments_status_timestamps`; OTP table constraints | Registration issue/status/complete/cancel and atomic owner-registration RPCs; payment-identity trigger/function; drops legacy registration OTP failure function; service-role-only RPCs. |
| 311200 | `uq_lead_refresh_org_cursor`, `uq_lead_refresh_profile_cursor` | Two signal RLS policies, bump/emit signal functions and lead trigger; removes raw leads from publication and adds sanitized signal columns. |
| 311300 | None | Replaces `get_telecaller_student_detail(uuid)`; leads ACL and postgres/public default ACL changes; service_role leads SELECT plus five column UPDATEs. |
| 311400 | None | Alters search_path on eight existing SECURITY DEFINER functions. |
| 311500 | `email_otps_ticket_id_uidx` | Issue/complete/cancel email OTP ticket RPCs, service-role-only. |
| 311600 | `organization_twilio_active_phone_uidx`, `leads_org_phone_inbound_idx`, `calls_twilio_provider_call_id_uidx`, call-bridge state/flow checks | Two service-only table policies; seven organization Twilio credential/call-routing RPCs, service-role-only. |
| 311700 | `billing_payments_verified_subscription_period`, refund/total-count checks | `apply_verified_razorpay_payment(...)`; service-role-only. |
| 311800 | None | `organization_has_active_paid_entitlement(uuid)`; service-role-only. |
| 20261101090000 | Outbox event unique and state check | Queue/claim/complete outbox RPCs; service-role-only, table RLS/direct access restrictions. |
| 20261101100000 | `organization_invitations_pending_org_email_uidx` partial unique index | Aggregate duplicate-PENDING check; no data rewrite. |

## Read-only diagnostic behavior

Run `supabase/tests/diagnose_all_production_migrations.sql` manually in the SQL Editor for the independently confirmed production project. It uses catalog reads and fixed aggregate-only SQL for duplicate checks. It does not return customer, lead, payment, subscription, or personal rows. It does not execute RPCs, change migration history, or issue DDL/DML. It prints actual relation/column/index/constraint/function/trigger/policy/ACL/publication metadata for source comparison, and migration-level results remain UNKNOWN if a required effect cannot be proven. Review the result against each migration source before any rollout decision.

## Prerequisites and aggregate conflict checks

The diagnostic reports whether base relations, the `extensions.uuid-ossp` extension, Supabase roles, publication and migration-history relation/versions exist. It checks aggregate counts (never row values) where needed: duplicate lower/trimmed profile emails, duplicate organization owners, pending-registration email conflicts, duplicate non-null OTP ticket IDs, duplicate pending invitations per organization/email, normalized organization/phone lead duplicates, duplicate CSV import markers, non-positive subscription amounts/total counts, invalid refund amounts, payment state/timestamp contradictions, and duplicate provider call IDs. `UNKNOWN` means the prerequisite relation/columns are absent or a safe aggregate check cannot be formed; it does not imply zero conflicts.

## Safe next steps

1. Independently confirm the production project target and take/verify a restorable backup. This report does neither.
2. Run the SQL Editor diagnostic; retain the complete output. Do not paste secrets or record rows.
3. Compare every catalog definition and aggregate result to the corresponding source migration. Resolve all `CONFLICTING` and `UNKNOWN` results before deciding replay vs. history baseline.
4. Do not replay 31 migrations as a batch and do not insert history rows from this diagnostic. Several migrations replace SECURITY DEFINER functions, alter broad/default ACLs and RLS, mutate distribution defaults, or change Realtime publication membership.
5. After a separate approval, prepare migration-specific preflights and a staged, version-by-version execution/baseline plan. No production apply command is authorized here.

## Limitations

- This report is based on local migration source and requester-supplied production facts, not live production catalogs.
- SQL source cannot by itself establish whether an unrecorded migration's effects are present in production.
- Function bodies, view definitions, RLS expressions, trigger definitions, index expressions/predicates, default ACLs and publication column filters require direct catalog output and source comparison. Name-only matches are insufficient.
- Aggregate conflict checks are diagnostic only; they do not determine whether a legacy row is semantically safe to preserve or whether a constraint change is operationally acceptable.
- No migration execution, history repair, deployment, provider operation, or application-code change was performed.
