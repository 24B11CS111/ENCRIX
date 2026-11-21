# ENCRIX implementation report

**Prepared:** 2026-11-04. This report distinguishes this pass's change from preexisting working-tree work. No deploy, Production SQL, external configuration change, credential rotation, email, call, or payment occurred.

## This pass

- Added a production build-time rejection when `VITE_ENABLE_DEMO_SANDBOX=true`.
- Added a regression case proving production rejects the flag, production accepts explicit false, and staging behavior remains unchanged.
- Files changed by this pass: `src/lib/supabaseProject.ts`, `src/test/supabase_environment_validation.test.ts`, plus this documentation set.

The initial concurrent run reported 939 passed and one failure because its worker loaded the module before the new source change was present. The focused rerun and final full suite below passed against the completed change.

## Existing implementation reviewed

- Server Supabase production validation requires canonical `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, rejects the legacy service key, and checks the production project reference. It does not fall back to `VITE_SUPABASE_URL` in production.
- Frontend Vite build validation requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and checks the production project reference outside Preview builds.
- Paid entitlements are server checked and fail closed. No subscription/pilot bypass was introduced.
- Pilot grant/revoke endpoints require active platform ADMIN, a bounded expiry and reason, plus `FOUNDING_PILOT_GRANTS_ENABLED=true`; the SQL functions independently verify admin identity and persist audit events.
- Checkout remains disabled in the plan catalog. The pilot release posture keeps automated Twilio calls and follow-up email off.

## Unresolved

- Production entitlement schema/RPC recovery and migration reconciliation are database-owner actions requiring review and explicit approval.
- Production OTP success, RLS/ACL correctness, tenant isolation, and customer persistence need current staging/Production evidence; local tests cannot establish them.
- Manual call outcomes and history are excluded until persistent server-backed behavior is demonstrated.
- A controlled customer invoice/payment process and lawful data import/retention/support procedures must be agreed before onboarding.

## Final local verification

| Command | Result |
|---|---|
| `npm test -- --maxWorkers=2 src/test/supabase_environment_validation.test.ts` | PASS — 1 file, 7 tests. |
| `npm test -- --maxWorkers=2` | PASS — 84 files, 940 tests. |
| `npm run build` | PASS — TypeScript project build, API typecheck, Vite production build. Vite warns that the main minified JS chunk is 1,525.35 kB, above its 500 kB advisory threshold. |
| `npx tsc --noEmit` | PASS. |
| `npx tsc --noEmit -p tsconfig.api.json` | PASS. |
| `npm run lint` | PASS (exit 0); Oxlint emits existing unused-variable, React hook/effect, immutability and purity warnings. |
| `git diff --check` | PASS (exit 0); Git emitted line-ending conversion warnings for existing modified files. |

These are local automated checks. No SQL test ran against a database, no Production state was verified, and no provider or deployed E2E test was performed.
