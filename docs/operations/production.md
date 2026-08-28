# Production deployment

Production uses a dedicated Supabase project and Railway project. It does not share PostgreSQL, Auth, Storage, Queues, secrets, or Railway services with staging.

## GitHub environment

Create a protected GitHub environment named `production` with these variables:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_URL`
- `PRODUCTION_ORIGIN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_PUBLIC_SERVICE_ID`
- `RAILWAY_WORKER_SERVICE_ID`
- `OPERATOR_ID`
- `INVITATION_DELIVERY_KEY_ID`
- `APPLICATION_WRAPPING_KEY_ID`

Add these secrets:

- `SUPABASE_MIGRATION_DATABASE_URL`
- `SUPABASE_RUNTIME_DATABASE_URL`
- `SUPABASE_WORKER_DATABASE_URL`
- `SUPABASE_SECRET_KEY`
- `DATABASE_CA_CERT`
- `RAILWAY_CONFIG_B64`
- `OPERATOR_PROVISIONING_TOKEN`
- `INVITATION_HMAC_KEY`
- `INVITATION_DELIVERY_KEY`
- `APPLICATION_WRAPPING_KEY`
- `APPLICATION_IDEMPOTENCY_KEY`
- `RESEND_API_KEY`
- `INVITATION_EMAIL_FROM`

The production migration creates or rotates dedicated non-owning runtime and worker database logins from the credentials in their connection URLs. The migration URL is owner-only and is never published to Railway.

## Deploy

Run the **Deploy production** workflow. It verifies the repository, applies forward migrations and restricted grants, synchronizes each Railway service's variables, deploys both services, checks the public HTTP controls, compares the deployed artifact digest with the CI build, and verifies the operator workspace catalog without creating fixture records.

The production migration does not create the staging provider-smoke Queue or Cron job. Production creates only the private application buckets and delivery queues required by the running application.

## First workspace

1. Open `/operator` and sign in with `OPERATOR_PROVISIONING_TOKEN`.
2. Create the School Workspace, then provision its first Staff Identity with Administrative Permission.
3. Deliver the one-time password out of band.
4. The staff member signs in at `/staff/sign-in`, enrolls TOTP, and opens `/staff/configuration`.
5. Select **Start school configuration** and enter the school display and short names.
6. Author and publish the branding, Intake Form, Learning Modules, and Managed Translations through the application.
7. Create the pilot Class and Invitations from the staff workspace after the active configuration is published.

The initialization path creates fresh resource identities. It does not import the synthetic staging fixture.
