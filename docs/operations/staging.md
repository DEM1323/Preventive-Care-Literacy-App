# Staging deployment

Supabase operates the managed PostgreSQL, Auth, private Storage, Queues, and Cron capabilities. Render runs one public same-origin web/API process and one private background worker from the same Docker image. School staff use purpose-built application screens; only the Technical Operator uses the Supabase and Render dashboards.

## Required controls

- A dedicated Supabase staging project in a US region with SSL enforcement and daily backups. The staging migration creates the dedicated `provider-smoke` Queue, minute-scheduled `provider-smoke` Cron job, restricted health function, and private `private-records` Storage bucket; do not create these manually under a different owner.
- Separate PostgreSQL migration and restricted runtime logins. The migration URL exists only in the GitHub `staging` environment. Render receives only the restricted runtime URL.
- Render web and background-worker services created from `render.yaml`, with automatic deployments disabled. Both services use the same private GHCR credential and are updated only by the staging workflow.
- Render secrets for the restricted `DATABASE_URL`, Supabase server key, Resend key, controlled provider-smoke mailbox, operator bootstrap token, and operator identity. No server key or database URL uses a `VITE_*` name.
- A GitHub `staging` environment containing the secrets `SUPABASE_MIGRATION_DATABASE_URL`, `SUPABASE_RUNTIME_DATABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `PROVIDER_SMOKE_EMAIL`, `PROVIDER_SMOKE_EMAIL_FROM`, `RENDER_API_KEY`, `RENDER_OWNER_ID`, `RENDER_WEB_SERVICE_ID`, and `RENDER_WORKER_SERVICE_ID`.
- GitHub environment variables `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_QUEUE_NAME`, `SUPABASE_CRON_JOB_NAME`, and `RENDER_STAGING_ORIGIN`.

Render is IPv4-only. Use Supabase's IPv4 direct connection or its session pooler on port 5432 for the persistent Render processes. Do not use transaction-pooler port 6543 because the application relies on transaction-local workspace context and advisory locks. Keep the combined web and worker pool sizes within the Supabase plan's connection limit.

## First deployment

Run the `Build and deploy staging` workflow once with `bootstrap_only` enabled. This publishes `ghcr.io/dem1323/preventive-care-literacy-app:staging-bootstrap` without requiring Render service IDs. Create the Render Blueprint from `render.yaml`, attach a GHCR credential if the package is private, enter the service secrets, and then record both Render service IDs in the GitHub `staging` environment. Subsequent workflow runs leave `bootstrap_only` disabled.

## Promotion and evidence

CI verifies source and contracts, builds one `linux/amd64` image with SBOM and provenance, and pins its digest. It rejects migration or runtime URLs that do not match `SUPABASE_PROJECT_REF` and runs forward migrations from that exact image with an ephemeral migration credential. The workflow deploys the same digest to Render web and worker, then runs a one-off provider job from the deployed worker artifact. That job verifies the runtime login cannot own protected objects or bypass RLS, calls Auth settings, confirms the Storage bucket is private, writes and removes a synthetic object, round-trips a synthetic Queue message through its fixed-name restricted function, requires a recent successful Cron run, and sends one neutral email to the controlled mailbox. Failed deployment, digest substitution, or provider verification rolls both services back before focused HTTP security and paginated Render-log telemetry checks run.

Render cannot atomically switch two services. Migrations therefore remain expand/contract compatible. If worker promotion or provider verification fails after web promotion, CI redeploys both services' previous digests before failing the release.

The provider and telemetry checks expose only fixed capability names, status, and duration. They discard provider bodies and errors and prohibit addresses, codes, session handles, answers, request bodies, and generated content.

Supabase-managed encryption is sufficient only for this empty synthetic staging slice. Supabase Vault is not a replacement for application envelope encryption. A concrete key-management decision remains a prerequisite before protected Intake answers are admitted under issue #28.
