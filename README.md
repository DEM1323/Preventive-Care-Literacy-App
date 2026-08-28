# PrevCare - Preventive Care Literacy App

Multilingual static prototype for K-12 English Learners: health intake and micro-lessons (Knowledge → Skills → Application).

> **Synthetic data only.** The prototype has no production authority. Never enter real Student information. See [the retirement and cutover record](docs/security/prototype-retirement.md).

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS v4**
- **Bun** (package manager)
- **Fastify + TypeBox/OpenAPI** (same-origin API)
- **Kysely + PostgreSQL** (modular-monolith persistence)

## Quick Start

```bash
bun install
bun run dev
```

Keep local configuration outside the repository. For example, place it at `~/.config/prevcare/credentials/local.env`, then load it into the shell before starting Vite.

## Routes

| Route                  | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `/operator`            | Technical Operator workspace catalog, creation, and Staff provisioning       |
| `/staff/sign-in`       | Staff password and mandatory TOTP authentication                             |
| `/staff`               | Permission-filtered staff workspace, including clinical Intake Record reveal |
| `/student/invitation`  | Delivered Invitation Code redemption                                         |
| `/student/sign-in`     | Sign-In Code starts a Student Session and restores durable school state      |
| `/student`             | Server-authoritative Student access restoration                              |
| `/student/intake`      | Synthetic Student Intake Draft and submission                                |
| `/student/learning`    | Server-confirmed Item Completion for one item                                |
| `/staff/configuration` | Administrator authoring, preview, and freshness-gated publication            |
| All other routes       | Prototype retirement notice                                                  |

## Verification

```bash
bun test
bun run typecheck
bun run build
bun run check:security
```

The audited backend spine has one reproducible verification command. It checks formatting,
types, module boundaries, deterministic OpenAPI and generated-client artifacts, repeatable
migrations against ephemeral PostgreSQL, and the focused transactional command test:

Operational readiness and incident recovery: [docs/operations/operational-readiness.md](docs/operations/operational-readiness.md).
Provider dashboard steps the application cannot perform: `scripts/record-operational-provider-evidence.sh`.
School acceptance and release-candidate evidence: [docs/operations/release-candidate-evidence.md](docs/operations/release-candidate-evidence.md).
Human School Nurse and native-browser steps: `scripts/run-release-candidate-acceptance-wizard.sh`.

```bash
bun run verify:install
```

Generate API artifacts after changing an HTTP contract with `bun run generate:contracts`.
Apply forward migrations to an explicit database with
`DATABASE_URL=postgres://... bun run migrate`.

The Supabase and Railway staging topology is documented in
[`docs/operations/staging.md`](docs/operations/staging.md). Railway builds the repository's
source through its checked-in Dockerfile and runs one same-origin web/API process. GitHub's
manual staging workflow verifies the deployed HTTP security controls.

The API process must use a separate PostgreSQL login without `SUPERUSER` or `BYPASSRLS`.
Starting the API also requires an operator-only provisioning token of at least 32 characters
and its audited identity:

```bash
DATABASE_URL=postgres://restricted-runtime-role/... \
OPERATOR_PROVISIONING_TOKEN=... \
OPERATOR_ID=operator@example.test \
bun apps/server/src/api.ts
```
