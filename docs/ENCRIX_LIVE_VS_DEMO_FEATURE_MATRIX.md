# ENCRIX Live vs Demo Feature Matrix

LIVE means verified persistent backend behavior plus authorization in the target environment. Source code, local mocks, UI screens, or historical preflight results alone do not qualify.

| Capability | Public demo | Live release status | Notes |
|---|---|---|---|
| Demo organization and accounts | DEMO | COMING SOON for client-specific tenant setup | Fictitious organization/team only. No sign-in; no auth bypass into the app. |
| Dashboard totals/activity | DEMO | COMING SOON / unverified | Demo calculations use the local synthetic dataset; chart is illustrative. |
| Lead create/edit/delete/search/filter/status | DEMO | COMING SOON / unverified | Demo state is in memory; no data persists after leaving. |
| Lead assignment and reassignment | DEMO | COMING SOON / unverified | Synthetic team and session activity only. |
| Follow-up scheduling/completion | DEMO | COMING SOON / unverified | No server persistence, reminders, or email. |
| Team roster/performance | DEMO | COMING SOON / unverified | Static synthetic accounts/figures. Invitations disabled. |
| Activity and notifications | DEMO | COMING SOON / unverified | Session-only activity and sample notification copy. |
| Owner OTP/login and session | Not part of public demo | COMING SOON / target verification required | Existing secure code paths exist. Do not treat code presence as current verification. |
| Telecaller invitation and access | Disabled in public demo | COMING SOON | Requires verified organization entitlement, migration state and role authorization. |
| CRM persistence / tenant isolation | No live data used | COMING SOON until target tests pass | Must verify persistence, owner/telecaller boundaries, and cross-tenant denial. |
| Razorpay checkout / entitlements | Disabled | COMING SOON | Do not accept payment or activate access based on mock/test success. |
| Automated Twilio calls | Disabled | COMING SOON | No provider call from demo. Live credentials, compliance and tenant configuration need verification. |
| Automated follow-up email | Disabled | COMING SOON | Demo scheduling is local only; mail pipeline readiness is not established here. |
| CSV lead import | Not exposed in demo | COMING SOON for client onboarding | Use the live import workflow only after server-side validation, persistence and authorization are verified. |

**Current LIVE-certified features from this pass: none.** The demo itself is functional but is explicitly classified DEMO, not LIVE.
