# ENCRIX Founding Client Edition

## Purpose

A prospect can explore an interactive CRM sandbox before Production integrations and database reconciliation are complete. The sandbox demonstrates the core lead-management workflow without requiring an account or touching live tenant data.

## Demo environment

- Open `/demo` from the landing page's **Try the Demo** link.
- Organization shown: **Northstar Learning** (fictional); persona: **Owner preview**.
- Leads, telecaller names, assignments, activity, follow-ups, and figures are synthetic.
- State stays in the React page's memory and resets when leaving or refreshing.
- The route is outside `AuthProvider`: it does not restore a Supabase session, call API endpoints, or issue CRM writes.
- Demo phone numbers are not shown. Email suffix `.example.test` is reserved for examples.
- The page persistently labels DEMO MODE and says that calls, emails, payments, and customer records are not live.

## Product audit summary

The repository already contains owner and telecaller workspaces for dashboards, leads, imports, assignments, calls, follow-ups, analytics, team, activity, security, and settings. There are also server API handlers for authentication, leads, follow-ups, billing, and telephony, plus Supabase client services and role-gated routes. These are implementation evidence only; their existence is not proof of current Production schema readiness, successful tenant isolation, or persistence.

The repository also contains an older `VITE_ENABLE_DEMO_SANDBOX` demo-data/auth path. The customer-facing `/demo` route does not reuse that path and is deliberately separate from live authentication.

## Honest release classification

The interactive `/demo` workflow is DEMO. No Production CRM feature is certified LIVE by this pass because no live persistence and authorization test was performed against a currently reconciled environment. Authentication and billing code exists; prior Production reports described incomplete billing prerequisites. Treat live access as COMING SOON / verification pending until the checks in the release plan pass.

## Scope boundaries

This work does not enable paid access, payment collection, automated calling, or automated follow-up email. The demo's team invitations are disabled. Do not import a prospect's real contact data into the shared demonstration. Configure a dedicated client tenant only after its access controls, schema, backup, and onboarding checks are approved.
