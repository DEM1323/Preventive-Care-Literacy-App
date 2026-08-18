# Staging deployment

The `Build and deploy staging` workflow builds one OCI image, records SBOM and SLSA provenance, and addresses it by digest. The forward-migration Cloud Run job must succeed before that exact digest is deployed to the public web/API service and private worker service. Staging is never rebuilt during promotion.

## Required controls

- A dedicated Cloud SQL for PostgreSQL instance labelled `environment=staging`, with daily backups and seven-day point-in-time recovery.
- Separate migration and runtime PostgreSQL logins. Only the migration URL is available to the migration job; the restricted runtime URL is available to the web/API service.
- Public web/API and private worker Cloud Run service accounts with least-privilege provider access. The worker has no unauthenticated invoker binding.
- Secret Manager values named `staging-migration-database-url`, `staging-runtime-database-url`, `staging-operator-token`, `staging-operator-id`, and `staging-resend-api-key`.
- A GitHub `staging` environment using Workload Identity Federation secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`.
- Repository variables matching every `vars.*` reference in `.github/workflows/staging.yml`. Resource names identify staging-only KMS, Storage, Tasks, Scheduler, Artifact Registry, service-account, Cloud SQL, and Cloud Run resources.

`STAGING_PUBLIC_ORIGIN` is the canonical HTTPS origin routed to the web/API Cloud Run service. No API is deployed on a second browser origin.

## Runtime evidence

The workflow rejects a Cloud SQL instance without the staging label or point-in-time recovery. After deployment it compares the resolved image reference for the migration job, web/API service, and worker service to the build digest. `scripts/check-staging.ts` then checks readiness, origin/CSRF enforcement, response headers, request-size and schema rejection, private provider status, secure attributes on any emitted cookies, and redaction of prohibited data classes.

Provider probes discard response bodies and errors. Their response and telemetry allow only the fixed provider name, `ok` or `error`, and duration. They never accept or emit addresses, codes, session handles, answers, request bodies, or generated content.
