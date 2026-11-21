# ENCRIX Production Supabase Environment Safety

## Production configuration

Configure these variables in the Vercel **Production** environment:

| Variable | Required value or action |
| --- | --- |
| `SUPABASE_URL` | `https://wrzoqxesffbfirjgotbr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The service-role key belonging to the production Supabase project. Store it only as a server-side Vercel secret. |
| `VITE_SUPABASE_URL` | `https://wrzoqxesffbfirjgotbr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The public anon/publishable key belonging to that same production project. |
| `SUPABASE_SERVICE_KEY` | Remove/unset this legacy variable in Production. It is deliberately rejected there. |

Never put a service-role/secret key in a `VITE_` variable or browser configuration. The validation code reports only a reason code or generic configuration error; it does not include configured values.

## Enforced behavior

- Production API initialization requires the canonical `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it does not use `VITE_SUPABASE_URL` or the legacy `SUPABASE_SERVICE_KEY` fallback.
- The backend parses the URL, accepts only a valid HTTPS Supabase project URL, and checks that its project reference is `wrzoqxesffbfirjgotbr`.
- Production rejects a missing, malformed, placeholder, or non-service-role backend key and rejects the presence of the legacy backend key.
- Production frontend builds require `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, reject placeholder inputs, and require the production project reference.
- Production browser initialization has no mock URL/key fallback. Development and staging modes retain their prior mock/configured behavior. Vercel Preview builds still require real frontend inputs but may target their separately configured project.
- Validation errors identify a category without printing URLs or keys.

## Safe correction and release sequence

1. In Vercel Project Settings, inspect Production and correct the four canonical variables above. Confirm the two URLs name the same production project and set the two keys from that same project. Unset `SUPABASE_SERVICE_KEY` from Production. Do not copy secrets into tickets, logs, source files, or `VITE_` variables.
2. Review the saved values using Vercel's masked interface. Do not paste the secret key into a shell or expose it in build output.
3. Build and review this code change and its tests. A failed production environment check must stop the build/startup rather than permit a different project.
4. Once the environment correction and code change are approved, create a **fresh Production deployment**. Vite embeds `VITE_` variables into the frontend bundle at build time, so an already-built deployment will continue to use the values present when it was built. Correcting Vercel variables alone does not update an existing deployment.
5. Before customer access, verify the deployed API and browser are connected to the intended project without exposing keys, and complete the release checklist.

This document does not authorize changing Vercel settings or deploying. Those actions require the operator's explicit approval.
