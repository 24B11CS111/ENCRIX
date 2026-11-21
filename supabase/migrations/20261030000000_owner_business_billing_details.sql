-- Owner onboarding business contact fields. Billing remains disabled until
-- Razorpay test setup and this migration are verified in staging.
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_location VARCHAR(500),
    ADD COLUMN IF NOT EXISTS website_url TEXT;

ALTER TABLE public.pending_registrations
    ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_location VARCHAR(500),
    ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Enforce registration idempotency at the database boundary. The indexes are
-- additive; creation fails safely if staging has pre-existing duplicates.
-- Preflight before applying (resolve manually; do not delete customer records):
-- SELECT lower(email) AS normalized_email, array_agg(id) AS profile_ids
-- FROM public.profiles WHERE email IS NOT NULL
-- GROUP BY lower(email) HAVING count(*) > 1;
-- SELECT owner_id, array_agg(id) AS organization_ids
-- FROM public.organizations WHERE owner_id IS NOT NULL
-- GROUP BY owner_id HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_lower
    ON public.profiles (LOWER(email))
    WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_id_unique
    ON public.organizations (owner_id);
