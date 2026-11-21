# ENCRIX founding pilot customer onboarding

## Pilot owner checklist

Before starting, confirm the business has signed the pilot terms and the ₹9,999 annual invoice/payment has been independently verified by authorized staff. Do not ask the owner to share passwords, OTPs, payment credentials, or database exports with support.

1. Create the organization through the reviewed owner registration flow. Confirm the legal/business name, owner email, and organization contact details with the owner.
2. Owner opens the production site and selects email OTP login. They enter the code only in ENCRIX. Confirm login success, organization name, and owner dashboard.
3. Verify a test lead can be created, edited, assigned to the owner or a test caller, reloaded, and found in the correct organization. Remove the test lead only through a reviewed, organization-scoped UI action.
4. Have the authorized platform ADMIN verify the organization entitlement grant after checking invoice/reference. Grant only the needed organization, for no more than 365 days, with an exact expiry and neutral audit reason. Verify the grant event and paid-gate access before importing customer data.
5. Review privacy, caller access, support route, pilot limitations, feedback cadence, and end date. Confirm the owner understands how to remove/reassign a lead and disable a telecaller.

## Owner setup flow

- Register/login with the business owner's unique email address and email OTP.
- Confirm the organization name, business details, timezone, lead status conventions, owner contact, and at least one backup owner contact outside the app.
- Invite callers by their individual business email using the in-app invitation flow. Never share an owner login with callers.
- Start with one or two synthetic test leads. Assign one to each intended caller and confirm both sides show the expected records.
- Add production lead data only after access checks and the import checklist pass.
- Use dashboard totals for basic operational review. Treat data exports and call automation as unavailable unless separately enabled after review.

## Telecaller setup guide

1. Accept the invitation from the intended business email and complete email OTP login.
2. Confirm the displayed organization and caller name with the owner before working any lead.
3. Review assigned leads only. Follow the business's consent, do-not-contact, calling-hours, and local privacy requirements.
4. For pilot calls, use the business's approved manual calling process. Do not expect ENCRIX to place calls, record calls, or send reminders automatically.
5. Update lead status and notes in the CRM. Call history/manual outcome entry is not included unless support has confirmed the server-backed feature is enabled; otherwise use the business's approved external call log. Do not put passwords, payment details, or sensitive special-category information into notes.
6. Report wrong assignments, missing leads, access errors, or suspected cross-organization data immediately; stop processing affected records until the owner/support confirms.

## Customer data import checklist

- [ ] Customer confirms they have a lawful basis/consent to use and share the records with their assigned staff.
- [ ] Import contains only agreed CRM fields needed for the pilot; remove passwords, payment-card/bank data, identity document numbers, unrelated notes, and special-category data.
- [ ] CSV header names and encoding are checked; dates/timezone and phone formats are consistent.
- [ ] Remove test rows, blank rows, unsupported columns, duplicate records, and records on do-not-contact lists before upload.
- [ ] Agree who may see each lead. Validate a small sample under owner and telecaller accounts before bulk import.
- [ ] Record filename, row count, importer, date, organization and result; do not place the raw file in support chat or email.
- [ ] Verify failed rows and retry behavior; confirm lead count and assignments after import.
- [ ] Store the original only in the customer's approved secure location. Remove temporary copies after successful import according to the agreed retention policy.

## Support issue template

```text
Organization ID (if safe to share):
Environment (production/staging):
Approximate time and timezone:
User role (owner/telecaller/admin):
Workflow (login, invite, lead, assignment, dashboard, other):
Steps to reproduce:
Expected result:
Actual result and visible error code:
Request/correlation ID (if shown):
Lead/record ID (test fixture only):
How many users affected:
Can work continue safely? (yes/no):
Screenshot with customer names/phones/emails hidden:
```

Never include OTP values, access/session tokens, passwords, full phone/email values, private customer CSVs, raw webhook bodies, provider credentials, or payment instruments. If a secret was shared, ask the operator to rotate it and remove the exposed copy through the approved incident process.

## 30-day feedback process

- **Day 0:** owner setup call, access checks, data import plan, success measures, contact path, and feature limitations. Record baseline lead count and current manual workflow time using aggregate numbers only.
- **Day 3:** short owner check-in for invitation completion, import errors, role/access confusion, and blocked workflows. Do not ask for raw customer files.
- **Day 7:** review lead persistence, assignment accuracy, caller adoption, status usefulness, and dashboard clarity. Triage defects separately from feature requests.
- **Day 14:** review usage friction, manual calling/outcome workflow, data quality, support response time, and security concerns. Confirm no one expects disabled automation.
- **Day 21:** check unresolved issues, user access changes, export/retention needs, and training gaps.
- **Day 30:** structured review against agreed measures: active users, leads processed, assignment success, status completeness, owner time saved, caller adoption, defects, and renewal interest. Decide continue/adjust/stop; do not silently extend entitlement.

At each checkpoint, store feedback without customer names, phones, lead contents, or secrets. Track issue ID, organization ID, severity, owner, due date, outcome, and whether the result is verified. For security incidents, stop the affected workflow and follow the incident process immediately rather than waiting for the next feedback meeting.
