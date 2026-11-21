# ENCRIX Next Release Plan

## Release objective

Move from a safe prospect demo to a narrowly enabled, persistent founding-client CRM pilot without relaxing authentication, RLS, tenant isolation, or entitlement checks.

## P0 — Demo release

- [x] Separate `/demo` route from AuthProvider and live session restoration.
- [x] Provide synthetic leads, statuses, assignments, follow-ups, team, notifications and activity.
- [x] Support in-memory add/edit/delete, search/filter, assignment, interaction and follow-up workflows.
- [x] Label DEMO MODE; disable invitations and avoid live providers.
- [ ] Review demo UX with a business owner and verify hosted build after normal deployment approval.

## P1 — Production readiness evidence

- [ ] Repeat current read-only Production preflights; earlier outputs are historical.
- [ ] Verify billing migration prerequisites, object conflicts, actual migration executor/default ACLs, backup and recovery.
- [ ] Obtain explicit approval before any Production database writes; apply reviewed migrations one by one only after approval.
- [ ] Verify auth/session expiry/logout, owner/telecaller authorization, tenant isolation, lead persistence and error handling on the deployed target.
- [ ] Confirm no checkout/payment entitlements or pilot access are enabled accidentally.

## P2 — Controlled pilot

- [ ] Configure one organization from the approved onboarding procedure.
- [ ] Onboard one owner and one test telecaller; verify invitation OTP and access boundaries.
- [ ] Import a customer-approved small data sample with backup and sign-off.
- [ ] Verify lead create/edit/assignment/status/follow-up persistence and audit history.
- [ ] Train users and monitor support issues for one week before adding further pilot businesses.
- [ ] Expand from 1 to 2–3 businesses only after the first tenant's security and workflow checks pass.

## P3 — Integrations

- [ ] Enable automated email, Twilio calls, and Razorpay only after independent provider tests, privacy/compliance review, environment separation, idempotency, webhook validation, support runbooks and explicit business approval.
- [ ] Do not use mock provider outcomes as proof of live completion or paid access.

## Exit criteria

A feature can be called LIVE only after persistent backend behavior and authorization are tested in the target environment, including negative tests for unauthorized and cross-tenant access. Keep everything else labeled DEMO or COMING SOON.
