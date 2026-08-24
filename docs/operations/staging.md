# Staging deployment

Supabase operates the managed PostgreSQL, Auth, private Storage, Queues, and Cron capabilities. Railway builds this repository from source and runs one public same-origin web/API process. The background worker is not deployed during this synthetic alpha stage. School staff use purpose-built application screens; only the Technical Operator uses the Supabase and Railway dashboards.

## Required controls

- A dedicated Supabase staging project in a US region with SSL enforcement and daily backups. The staging migration creates the dedicated `provider-smoke` Queue, minute-scheduled `provider-smoke` Cron job, restricted health function, and private `private-records` Storage bucket; do not create these manually under a different owner.
- The owner connection is used only from an operator-controlled migration command. Railway receives only the restricted runtime login, which is non-owning and cannot use `SUPERUSER` or `BYPASSRLS`.
- One Railway service connected to the repository's `main` branch. Railway builds the checked-in Dockerfile and uses `railway.json` for the readiness check and restart policy.
- Railway variables `DATABASE_URL`, `DATABASE_CA_CERT`, `PUBLIC_ORIGIN`, `OPERATOR_PROVISIONING_TOKEN`, and `OPERATOR_ID`. `DATABASE_CA_CERT` contains the Supabase server root certificate PEM. No database URL or server credential uses a `VITE_*` name.
- Railway variables `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the staff authentication seam. The server mediates password verification, TOTP enrollment, and assurance-level checks through Supabase Auth; browsers never receive Supabase credentials or tokens, and school staff never need Supabase dashboard access.
- A GitHub `staging` environment variable named `RAILWAY_STAGING_ORIGIN` plus the Supabase project, URL, Storage, Queue, and Cron names.
- GitHub `staging` secrets for the restricted runtime `DATABASE_URL` compatibility value `SUPABASE_RUNTIME_DATABASE_URL`, Supabase server key, Supabase root certificate, Resend key, and controlled provider-smoke sender and destination. Railway receives only the application variables.

Use Supabase's direct connection when Railway can reach the project's IPv6 endpoint; otherwise use the session pooler on port 5432. Do not use transaction-pooler port 6543 because the application relies on transaction-local workspace context and advisory locks. Keep the application pool within the Supabase plan's connection limit.

## First deployment

1. Create a Railway project with **Deploy from GitHub repo** and select this repository.
2. Add the five Railway variables listed above. Paste the Supabase server root certificate itself into `DATABASE_CA_CERT`; do not give Railway the owner database connection.
3. In the Railway service settings, generate a public domain. Set `PUBLIC_ORIGIN` to that exact HTTPS origin and redeploy.
4. Confirm `/health/ready` succeeds, then set `RAILWAY_STAGING_ORIGIN` in GitHub's `staging` environment.
5. Add the GitHub provider-check secrets and run the **Verify staging** workflow. It verifies repository controls, deployed HTTP security, and real PostgreSQL, Auth, private Storage, Queue, Cron, and email capabilities.

## Promotion and evidence

Railway records the Git commit used for each source deployment and can redeploy a previous successful version. Run forward migrations before deploying code that depends on them; migrations remain expand/contract compatible so the previous application version can continue to run during rollback. The GitHub staging workflow re-runs repository verification and checks readiness, origin and CSRF enforcement, secure cookies, CSP, HSTS, framing, MIME, referrer, request-size, and schema protections against the deployed origin.

The provider checks expose only fixed capability names, status, and duration. They discard provider bodies and errors and must not expose addresses, codes, session handles, answers, request bodies, or generated content.

## Staff identity provisioning

Staff Identities are provisioned by the Technical Operator after out-of-band school authorization; there is no self-service staff administration. Run `bun scripts/provision-staff.ts` once per staff member with the restricted runtime `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the `STAFF_*`, `SCHOOL_APPROVER`, and `PROVISIONING_REASON` inputs documented in the script header. For the alpha, provision the School Nurse with `STAFF_PERMISSIONS=administrative,clinical` and the Administrator with `STAFF_PERMISSIONS=administrative`. The script prints a one-time initial password; deliver it out of band. The staff member signs in at `/staff/sign-in`, enrolls TOTP from the shown authenticator URI, and thereafter reaches `aal2` before the server issues its opaque, non-persistent `__Host-prevcare-staff-session` cookie. Every protected request rechecks the Staff Identity, School Workspace, session, assurance timestamp, and permission grants in PostgreSQL, which independently enforces Administrative and Clinical Permission through row-level security.

Supabase-managed encryption is sufficient only for this empty synthetic staging slice. Supabase Vault is not a replacement for application envelope encryption. A concrete key-management decision remains a prerequisite before protected Intake answers are admitted under issue #28.
