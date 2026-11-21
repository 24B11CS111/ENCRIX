# ENCRIX Production Step 5 — Function and Procedure Audit

**Status: NOT EXECUTED — NO-GO.** The read-only diagnostic is prepared, but no Production routine results were collected.

## Target and execution status

- Supabase project: `ENCRIX`
- Project reference: `wrzoqxesffbfirjgotbr`
- Diagnostic: [diagnose_production_functions.sql](../supabase/tests/diagnose_production_functions.sql)
- Execution: **Not executed.** No approved read-only Production connection/tool is available in this session. Previous remote catalog attempts failed temporary database-role authentication; no credentials were retried, requested, or bypassed.
- Result sections and row counts: **Unknown** until run in the confirmed Production SQL Editor.
- No migration, database write, or Production change was made.

## Diagnostic coverage

The script has two read-only result sections:

1. `FUNCTION_CATALOG`: every public-schema function, procedure, aggregate, or window routine and its schema-qualified identity signature, return type, language, security invoker/definer mode, owner, volatility, strictness, set-returning flag, parallel-safety marking, function settings/search path, stored ACL, PUBLIC EXECUTE flag, and effective EXECUTE flags for `anon`, `authenticated`, and `service_role`. It also provides an MD5 fingerprint of `pg_get_functiondef` for routines with definitions; aggregate fingerprints are null.
2. `FUNCTION_SOURCE_EXPECTATIONS`: exact-signature presence checks for a focused set of sensitive migration-defined routines. It covers profile/role helpers, privilege escalation and platform-admin granting, follow-up processing, telecaller lead access, owner registration, registration and email OTP lifecycle, paid entitlement, Razorpay payment application, refund review/processing/reconciliation, subscription cancellation, and session revocation.

The query deliberately does **not** return raw function bodies: database drift could introduce a hardcoded credential into an otherwise executable definition. Fingerprints permit later comparison against locally reviewed definitions but do not disclose the source. Full source comparison remains an operator/reviewer task using trusted local repository sources and the Production fingerprint output.

`NOT_IN_FOCUSED_SOURCE_REGISTRY` means only that a routine is outside the focused list; it does **not** mean the routine is unexpected or malicious. `PRESENT_EXACT_SIGNATURE` establishes presence by signature only, not body equivalence or safe grants. A hash mismatch, absent signature, unusual owner/security mode/search path, or broad execute privilege requires review; it does not by itself authorize a database change.

## Migration source comparison performed

The focused registry was checked against source declarations and relevant access boundaries in:

- `20261001000001_security_hardening.sql`, `20261021000000_phase23_7_production_blocker_remediation.sql`, and `20261022000000_phase23_8_active_profile_rls.sql` — audit/profile helpers, privilege escalation, admin grant, active-profile helpers.
- `20261024120000_phase24_3_secure_telecaller_lead_access.sql` and `20261024130000_phase24_7_server_telecaller_leads.sql` — assigned telecaller updates and server-scoped lead reads/updates.
- `20261031000000_onboarding_billing_integrity.sql` and `20261031150000_durable_email_otp_attempts.sql` — owner registration and OTP issue/verification lifecycle.
- `20261031170000_razorpay_atomic_subscription_lifecycle.sql`, `20261031180000_paid_subscription_entitlement_gate.sql`, and later `20261105140000_paid_entitlement_provider_identity.sql` / `20261105150000_razorpay_active_subscription_required.sql` — payment application and entitlement gates.
- `20261105170000_billing_refund_cancellation_workflows.sql` and `20261106100000_admin_refund_management.sql` — refund request/review/provider result, webhook reconciliation, and period-end cancellation.
- `20261107100000_persistent_server_session_revocation.sql` — server session revoke/check.

This is a prioritized source registry, not a complete declaration map for every application function in all 41 migrations. All routines are inventoried by the catalog query, but non-listed routines need migration-source mapping before “unexpected” or “missing” conclusions can be made. Source expected signatures can also be present with a changed body; compare definition fingerprints and review source definitions before classifying drift.

## Security and integrity review criteria

- SECURITY DEFINER routines should have an owner and fixed, safe `search_path`, and narrow EXECUTE grants consistent with their callers. A blank `search_path` is not automatically unsafe if all references are fully qualified, but must be reviewed.
- OTP ticket routines, owner-registration routines, billing/refund/cancellation routines, and service-side telecaller RPCs should not become directly callable by `PUBLIC`, `anon`, or `authenticated` unless their source migration explicitly authorizes that exact interface.
- `PUBLIC EXECUTE` is distinguished from effective named-role execution. The latter can include role inheritance and PUBLIC grants.
- Client-facing telecaller functions must derive/check user, organization, role, active status, and assignment as defined in source; server-only variants must remain protected from client roles.
- Missing routines, overload mismatches, changed fingerprints, unexpected `SECURITY DEFINER`, weakened volatility/strictness/settings, or expanded grants require review against migration history and source. Do not repair based on presence alone.
- No Production routine definitions, privileges, or results have been observed in this step; there are no validated findings yet.

## Missing evidence

1. `FUNCTION_CATALOG` result section and exact row count.
2. `FUNCTION_SOURCE_EXPECTATIONS` result section and exact count of present/missing signatures.
3. Routines with unexpected owners, SECURITY DEFINER status, or `search_path`.
4. PUBLIC/anon/authenticated/service-role EXECUTE exceptions requiring comparison with migration grants.
5. Definition fingerprints compared with reviewed repository source, particularly the later replacements of payment and refund routines.
6. Classification of routines outside the focused source registry.

## Recommendation and next action

**NO-GO for Production changes and release approval.** Run the diagnostic in the existing ENCRIX Production SQL Editor only after verifying the project reference is `wrzoqxesffbfirjgotbr`. Save both complete result sets and provide their row counts plus entries with broad EXECUTE grants, unexpected security modes/settings/owners, and missing exact signatures. Keep raw function bodies and all credentials/secrets out of the shared output. Do not proceed to Step 6 or perform database changes before reviewing this evidence.

