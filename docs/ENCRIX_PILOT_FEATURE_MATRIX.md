# ENCRIX founding pilot feature matrix

| Feature | Pilot status | Conditions and limits |
|---|---|---|
| Owner registration and email OTP login | Conditional | Durable OTP SQL repair, grants, post-repair checks, and staging login/expiry/replay tests must pass before pilot release. |
| Organization management | Conditional | Owner identity and organization scope must be verified; no client-supplied organization ID may override authenticated profile scope. |
| Telecaller invitation/login | Conditional | Invitation/email OTP flow, expiry, reuse rejection, and owner/telecaller role boundaries require staging verification. |
| Lead creation/editing | Core pilot | Server persistence and reload behavior must pass with synthetic staging records before customer import. |
| Lead assignment/reassignment | Core pilot | Organization ownership and caller assignment checks must pass; cross-tenant IDs must fail closed. |
| Lead status tracking | Core pilot | Use only implemented status values; verify updates persist and feed counts correctly. |
| Call history | Excluded pending verification | Current call history pages read client-side `db` arrays; no server-backed list/reload path was verified. Use an approved external call log until fixed and tested. |
| Manual call outcomes | Excluded pending verification | Current outcome entry writes through client-side `db.recordCallOutcome`; no server-backed persistence path was verified. Do not treat mock/demo writes as customer records. |
| Basic dashboards | Core pilot | Organization-scoped counts and empty/error states; advanced reporting is outside the pilot promise. |
| Tenant and role security | Mandatory gate | Production catalog/RLS/ACL review plus staging owner/telecaller cross-tenant and wrong-role tests. |
| Session expiry/logout | Mandatory gate | Staging must verify server rejection after expiry/logout and client cache clearing. |
| Server error handling | Mandatory gate | Generic safe responses, redacted logs, and tests for DB/RPC failure paths. |
| Founding pilot entitlement | Candidate, inactive | New migration/API add a 3-active-org cap, max 365-day expiry, active platform ADMIN grant/revoke, event audit, and same server entitlement RPC. `FOUNDING_PILOT_GRANTS_ENABLED=false` by default. Review and test migration first; no grants are activated. |
| Business price | Commercial offer | ₹9,999 per organization for 12 months, subject to approved invoice/payment process. No payment was collected by this work. |
| Razorpay live checkout | Disabled | `checkoutEnabled` is false in the pilot code; API supports only Razorpay Test Mode keys. Enable only after independent review, tests, and explicit approval. |
| Automated Twilio calling | Disabled | API returns unavailable unless `TWILIO_CALLING_ENABLED=true`; keep unset/false in pilot. No real calls/messages. |
| Automated follow-up emails | Disabled | Dispatcher sends only when `ENABLE_FOLLOWUP_EMAIL_REMINDERS=true`; keep unset/false. Manual owner follow-up is the pilot process. |
| Automated payment entitlements | Disabled/unverified | Only a verified Razorpay lifecycle or separately reviewed pilot grant inside the database authority can activate access. Never trust browser checkout state. |
| Mock-only or unfinished features | Excluded | Do not represent mock telephony, demo data, unfinished admin tools, or unverified screens as live customer functionality. |
| Data export and bulk operations | Restricted | Verify organization scope and role access before offering. Do not promise raw telecaller export. |

## Pilot exit rule

If a feature's staging behavior, database persistence, authorization, and operational support are not verified, mark it unavailable and provide a manual customer workflow only when safe. Do not change the UI to imply a feature is available when its API gate, schema, or provider is not ready.
