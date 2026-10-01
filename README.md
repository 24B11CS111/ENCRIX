# LEADVAULT — Secure Telecaller CRM

> **Tagline:** *Your Leads. Your Data. Under Your Control.*

LEADVAULT is a full-stack, real-time, multi-tenant SaaS application built for high-trust businesses (Education consultancies, Real estate firms, Recruitment agencies, Financial advisors, Marketing agencies) that distribute customer leads to telecallers without risking data theft, unauthorized downloads, or unmonitored spreadsheet sharing.

---

## 1. Core Architectural Principles

1. **Zero Raw Spreadsheet Distribution:** The business owner ingests leads into LEADVAULT. Telecallers never receive the raw database or unfiltered files.
2. **Data Masking at Data Access Boundary:** Surnames and phone numbers (`+91 ******3210`, `Rahul K.`) are masked at the API & database layer before reaching telecaller interfaces.
3. **Authorized Calling Gateway:** Calls are routed exclusively through supported telephony infrastructure (`MockTelephonyProvider`, Twilio, Exotel, Knowlarity) with statutory compliance recording prompts.
4. **PostgreSQL Row Level Security (RLS):** Organization A can never physically access Organization B. Telecallers can only query and mutate records assigned to their user ID.
5. **Real-Time Cross-Role Sync:** Live updates between owner and telecaller screens without manual page refreshes.

---

## 2. Technology Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons
- **State & Query:** React Context, TanStack Query, BroadcastChannel
- **Data Validation & Parsing:** Zod, React Hook Form, PapaParse
- **Visualization:** Recharts (Lead Funnel, Calls Over Time, Source Breakdown, Agent Output)
- **Backend & Database:** PostgreSQL with Row Level Security, Supabase Auth & Realtime
- **Telephony Abstraction:** `TelephonyProvider` interface with `MockTelephonyProvider` & SIP bridge
- **Testing:** Vitest, `@testing-library/react`, `@testing-library/jest-dom`, JSDOM

---

## 3. Multi-Tenant Role Matrix

| Capability | ADMIN | OWNER | TELECALLER |
| :--- | :---: | :---: | :---: |
| Platform Tenant Health & Overview | ✅ | ❌ | ❌ |
| Create / Suspend Organizations | ✅ | ❌ | ❌ |
| Master Lead Vault & Unmasked Data | ✅ | ✅ | ❌ |
| Lead CSV / XLSX Import Wizard | ❌ | ✅ | ❌ |
| Manual & Round-Robin Lead Assignment | ❌ | ✅ | ❌ |
| Telecaller Account Creation & Suspension | ❌ | ✅ | ❌ |
| View Assigned Leads Only (Masked) | ❌ | ❌ | ✅ |
| Place Calls via Gateway & Record Outcomes | ❌ | ✅ | ✅ |
| Positive Flow (Interest, Requirements, Calendar) | ❌ | ✅ | ✅ |
| Negative Flow (Reasons, Disqualification Notes) | ❌ | ✅ | ✅ |
| Download Raw Database Export | ❌ | ✅ (Audit Only) | 🚫 BLOCKED & LOGGED |
| Security Operations Center & Alerts | ✅ | ✅ | ❌ |

---

## 4. Folder Structure

```
ENCRIX/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── common/         # StatusBadge, PriorityBadge, UserAvatar, EmptyState, SearchBar, Pagination
│   │   └── layout/         # Navbar (realtime feed, quick demo switcher), Sidebar, MobileNav, AppLayout
│   ├── features/
│   │   ├── auth/           # AuthContext, RoleGate, Form validation
│   │   ├── leads/          # LeadDrawer, LeadImportWizard, LeadAssignModal
│   │   ├── calls/          # CallModal (live timer, mute, end), OutcomeModal (positive/negative flows)
│   │   └── security/       # Export protection, Anomaly heuristics
│   ├── lib/
│   │   ├── dataMasking.ts  # Masking functions (Rahul K., +91 ******3210)
│   │   ├── utils.ts        # Formatting (duration, relative time, currency)
│   │   └── validation.ts   # Zod schemas
│   ├── pages/
│   │   ├── LandingPage.tsx # Polished marketing landing page with interactive demo launcher
│   │   ├── auth/           # LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage
│   │   ├── owner/          # Dashboard, Leads, Import, Assignments, Team, Calls, Follow-ups, Analytics, Security
│   │   ├── telecaller/     # Dashboard, My Leads, My Calls, Follow-ups, Performance, Profile
│   │   └── admin/          # Platform Overview, Organizations, Users, Activity, Security, System Health
│   ├── services/
│   │   ├── supabase/       # Client, LeadVaultDb (persistence & RLS engine), Demo data generator
│   │   └── telephony/      # TelephonyProvider interface & MockTelephonyProvider
│   ├── test/               # Vitest suites (security_isolation, lead_workflow, calling_lifecycle, realtime_sync)
│   ├── types/              # Domain models and TypeScript contracts
│   ├── App.tsx             # Route declarations & role gates
│   └── main.tsx            # Application entrypoint
├── supabase/
│   └── migrations/
│       └── 20261001000000_init_leadvault.sql # Master schema with tables, RLS policies & indexes
├── .env.example
├── package.json
└── vite.config.ts
```

---

## 5. Getting Started & Development

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation
```bash
# Clone the repository
git clone <repo-url>
cd ENCRIX

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### Running Locally
```bash
# Start Vite development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 6. Pre-Seeded Enterprise Demo Personas

LEADVAULT includes a zero-configuration local sandbox with 100+ demo leads, 100+ call records, follow-ups, and logs for **Vertex Consultancy**:

1. **Owner Persona:**
   - Email: `owner@vertex.com`
   - Access: Full organization dashboard, unmasked leads, CSV import, round-robin assignments, team KPIs.
2. **Telecaller Persona:**
   - Email: `arjun@vertex.com`
   - Access: Restricted mobile-first queue (`tc-arjun-01`), masked customer phones (`+91 ******3210`), calling interface, outcome logger.
3. **Platform Super Admin:**
   - Email: `admin@leadvault.com`
   - Access: Global tenant oversight, security operations center, system health.
4. **Tenant B (Cross-Tenant Isolation Test):**
   - Email: `owner@prime.com`
   - Access: Prime Careers workspace. Testing verifies that Vertex Consultancy leads and Prime Careers leads are completely segregated.

*Quick Switcher:* Use the top navigation bar's **Role: [ROLE]** button to switch personas instantly with 1-click!

---

## 7. Connecting to Live Supabase

1. Create a new project in [Supabase](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard and run the contents of:
   ```
   supabase/migrations/20261001000000_init_leadvault.sql
   ```
3. Update your `.env` file:
   ```env
   VITE_SUPABASE_URL=https://your-supabase-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```
4. Restart the development server: `npm run dev`.

---

## 8. Running Automated Tests

Run the Vitest test suite covering security isolation, lead import, calling lifecycle, and real-time updates:

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch
```

**Test Coverage Highlights:**
- `security_isolation.test.ts`: Confirms Organization A cannot access Organization B; Telecallers cannot see other telecallers' leads; Data masking is enforced; Telecaller security stream access is rejected.
- `calling_lifecycle.test.ts`: Tests `MockTelephonyProvider` dial/mute/hangup lifecycle, positive outcome `INTERESTED` status changes, and negative outcome `NOT_INTERESTED` status changes.
- `lead_workflow.test.ts`: Tests lead creation, CSV import parsing/validation, manual assignment, and round-robin distribution.
- `realtime_sync.test.ts`: Verifies cross-role real-time event broadcasting.

---

## 9. Production Build

```bash
npm run build
npm run preview
```

Output is emitted to `/dist`, ready for deployment to Vercel, Netlify, AWS CloudFront, or any modern edge hosting platform.
