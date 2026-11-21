# ENCRIX main Production deployment preparation

**Status: NO-GO; preflight only.** This runbook is a proposal, not authorization. No Production migration, variable change, deployment, payment, refund, email, or phone call was performed.

See the [release preflight report](../RELEASE_CANDIDATE_REPORT.md) for verified evidence and [database migration plan](./ENCRIX_DATABASE_MIGRATION_PLAN.md) for all 41 source migrations and risk/data notes.

## Confirmed target and current blockers

- Supabase main project: `ENCRIX`, ref `wrzoqxesffbfirjgotbr`, URL `https://wrzoqxesffbfirjgotbr.supabase.co`, PostgreSQL `17.11`, region `eu-west-1`.
- The local Supabase CLI link is `vhqqczgomrznisvbhpvf` (`ENCRIX-Staging`); do not use it implicitly for main. All main history lookup used explicit project ref.
- Only `20261001000000` and `20261001000001` are recorded in main migration history. The remaining 39 repository versions are unrecorded, but the live DDL effects were not established.
- Direct catalog queries failed temporary-role password authentication. No credentials were accessed or displayed. Production schema, policies, grants, extensions, data conflicts and backup/restore readiness remain unknown.
- Vercel project `encrix`, domain `https://encrix.vercel.app`, Vite/root `.`, Node `24.x`; build command `npm run build` / `vite build`; output-directory setting unset (`None`; Vite default `dist`). `.vercel/project.json` is absent.
- Supabase Auth read-only settings showed email enabled, sign-up enabled and auto-confirm disabled. Site URL and redirect allow-list remain unverified.
- Do not deploy or configure the project until database evidence, restorable backup/PITR, Auth redirects, Vercel environment names/scopes, and separate approvals are complete.

## Required environment variable names (values must remain secret)

The Vercel Production names-only inventory contained `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, OTP/session, email, Razorpay, Twilio, and cron entries. It also contains `NEXT_PUBLIC_*` Supabase names and obsolete `SUBSCRIPTION_ENFORCEMENT_ENABLED`. These observations do not verify secret values or correctness.

The following application-declared names were not found in that names-only inventory and must be checked by an authorized operator:

- `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT`
- `TWILIO_CREDENTIAL_ENCRYPTION_KEYS`
- `TWILIO_CREDENTIALS_ACTIVE_KEY_ID`
- `TWILIO_PUBLIC_WEBHOOK_BASE_URL`

The source checklist also includes `SESSION_SERVER_SECRET`, `OTP_SERVER_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optional `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL`, `CRON_SECRET`, `ENABLE_FOLLOWUP_EMAIL_REMINDERS`, `TWILIO_CALLING_ENABLED`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `RAZORPAY_PLAN_BUSINESS`. Confirm the exact code-required set and Vercel Production scope before any update. Never put server secrets in `VITE_` variables, print environment values, or copy Production credentials into another environment.

## Local checks already evidenced

- `npm test`: 90 files, 1,008 tests passed.
- `npm run build`: exit 0, including TypeScript checks and Vite production build.
- `npm run lint`: exit 0, 140 warnings, no errors.
- Isolated PostgreSQL 17: 41/41 migrations and 16/16 SQL regression tests passed. This is not Production catalog evidence.

## Read-only recheck commands

Only run these with an authenticated operator account; commands must target the explicit main ref:

```powershell
supabase projects list
supabase migration list --linked --project-ref wrzoqxesffbfirjgotbr --dns-resolver https
vercel project ls --scope anurags-projects-157b861e
vercel env list production --project encrix --scope anurags-projects-157b861e
```

Do not use `--json` for environment inspection. It can expose values. The previous catalog queries could not authenticate as Supabase's temporary database role. An authorized operator must arrange a secure local read-only connection or run reviewed read-only catalog/aggregate queries in the confirmed Supabase SQL Editor; do not send a database password in chat.

## Ordered plan — only after separate approvals

1. **Database evidence:** confirm project identity, collect catalog and aggregate-only compatibility evidence, reconcile each migration against actual effects, and verify a restorable backup/PITR point and named recovery owner.
2. **Migration review:** test the exact selected scripts on the isolated PostgreSQL 17 baseline, resolve conflicts without deleting customer data, and approve a per-file dependency order. Do not blanket-replay unrecorded versions.
3. **Application connection:** after explicit approval, link the local checkout to the named Vercel project if needed:

   ```powershell
   vercel link --project encrix --scope anurags-projects-157b861e
   ```

   Keep local `.env.production` values private. Do not switch local application traffic to the main database just to test.
4. **Database execution:** only after separate explicit database approval, use the approved operator workflow to apply one individually reviewed migration at a time. Example only; configure the named libpq service with protected credentials and never put them in command arguments or shell history:

   ```powershell
   $env:PGSERVICE = "encrix-production-approved-migrator"
   psql -W -X -v ON_ERROR_STOP=1 -f ".\supabase\migrations\<approved-version-and-filename>.sql"
   ```

   Configure that libpq service through the operator's protected credential mechanism; `-W` prompts for a password rather than putting it in the command. Stop and verify catalog postconditions before proceeding. **Never run `supabase db push`, a migration loop, automatic migration repair, or history-only edits.**
5. **Environment configuration:** after separate Vercel approval, configure only the reviewed names/scopes in the Vercel dashboard. Verify names without displaying values; keep service-role, OTP/session, provider and webhook secrets server-only. Configure email OTP, Auth Site URL/redirect allow-list, Razorpay Test Mode/webhook and Twilio test configuration only when separately approved. No provider actions are authorized by this plan.
6. **Build/deploy:** on the exact reviewed candidate, run:

   ```powershell
   npm ci
   npm test
   npm run build
   npm run lint
   ```

   Deployment requires its own explicit approval. Only then may the approved operator run:

   ```powershell
   vercel deploy --prod --project encrix --scope anurags-projects-157b861e
   ```

7. **Post-deploy verification:** check `https://encrix.vercel.app` and `/api/health`, inspect redacted logs, confirm auth redirects and tenant boundaries, and verify no unauthorized entitlement activation. Do not use real payments, refunds, phone numbers, emails, or provider credentials for acceptance tests.

## Business invariants and stop conditions

- ₹9,999 annual subscription; ₹10,000 onboarding fee deferred.
- Manual review for every refund; cancellation at paid-period end.
- Full refunds revoke paid entitlement; partial refunds require an explicit admin retain/revoke decision.
- Stop if project identity, catalog state, duplicate/data preflight, backup, function ACL/RLS checks, environment validity or application smoke evidence differs from the approved plan.
- No Production deployment is recommended until every critical gate has evidence and separate database and deployment approvals are granted.
