# ENCRIX Founding Client Onboarding

## Readiness gate

Do not activate an organization, accept payment, or import customer data until the current Production schema, entitlement behavior, authentication, organization isolation, backups, support owner, and release approval are verified. The public demo is not an onboarding tenant.

## Pilot onboarding checklist

- [ ] Confirm signed commercial scope, named business owner, contacts, pilot dates, data processing expectations, support channel and success measures.
- [ ] Create organization through the approved owner registration flow; verify the owner by the production OTP flow.
- [ ] Confirm owner profile, organization ID, organization status and business details through authorized server-side queries.
- [ ] Verify tenant policies and owner/telecaller role boundaries; run cross-organization denial checks.
- [ ] Verify paid entitlement from the approved billing source. Do not manually bypass subscription checks or issue an unreviewed pilot grant.
- [ ] Invite telecallers only after invitation email/OTP, role assignment and entitlement checks pass.
- [ ] Import only after client approves mapping, deduplication, consent/source fields, sample preview and backup/rollback plan.
- [ ] Validate a small client-approved sample, counts, ownership, assignment and access; obtain owner sign-off before full import.
- [ ] Train owner and telecallers; explain call, email, export, retention and access limits.
- [ ] Set a 30-day review date and capture baseline and outcome measures.

## Owner setup flow

1. Owner opens the approved registration page and submits organization details.
2. Owner verifies email via OTP; no staff member should ask the owner to share an OTP.
3. Owner confirms organization name, industry, business contact and timezone.
4. Owner signs in, reviews role/access guidance, and checks the dashboard is scoped to their organization.
5. Owner adds telecallers via the verified invitation flow, then assigns a small approved lead set.
6. Owner confirms the pilot start date, authorized data sources, support contact and success goal.

## Telecaller setup guide

1. Open the invitation received from the organization owner and verify email with the invitation OTP.
2. Set account security details and sign in through the official app URL.
3. Confirm the organization name and role badge; never share credentials or OTP codes.
4. Review only assigned leads, record outcomes accurately, and schedule follow-ups according to organization policy.
5. Do not export, screenshot, retain locally, or contact people outside approved business processes. Raise wrong assignments or privacy concerns through the support channel.

## Customer data import checklist

- [ ] Written owner approval and lawful collection/contact basis confirmed.
- [ ] Secure transfer channel agreed; do not send spreadsheets through public demo or chat.
- [ ] Original file backed up by customer; encrypted copy access is limited.
- [ ] Columns mapped; required fields, status vocabulary, source, consent, assignment and timezone reviewed.
- [ ] Duplicates, malformed emails/phones, formula cells and unsupported values identified before import.
- [ ] Small anonymized or approved sample preview accepted by owner.
- [ ] Import size and error handling checked; no overwrite/merge ambiguity.
- [ ] Post-import row counts, organization ownership, access controls and sample records verified.
- [ ] Temporary files removed according to the agreed retention procedure; record sign-off.

## Support issue template

- Organization name/ID (never include customer secrets):
- Reporter role and contact method:
- Date/time and timezone:
- App page and action:
- Expected result:
- Actual result and exact non-sensitive error text:
- Reproduction steps using a synthetic record:
- Browser/device/version:
- Approximate affected record count (no names or phone numbers):
- Business impact and urgency:
- Screenshot with personal data redacted:
- Workaround attempted:
- Permission to contact reporter:

Never include passwords, OTP values, authorization headers, secret keys, or unredacted customer personal information.

## 30-day feedback cadence

- **Day 0:** Capture baseline (lead response time, follow-up completion, assignment process) and owner/telecaller goals.
- **Day 3:** Short setup check: access, workflow friction, data quality and urgent blockers.
- **Day 7:** Review usage and missing capabilities; separate defects from feature requests.
- **Day 14:** Review role boundaries, follow-up habits and owner visibility; record prioritized changes.
- **Day 21:** Check adoption and measurable movement against the baseline; agree any training refresh.
- **Day 30:** Formal review: outcomes, risks, support history, renewal/expansion decision, and written feedback approval.

Collect the minimum necessary feedback, use synthetic examples when possible, and store customer feedback only in the approved support system.
