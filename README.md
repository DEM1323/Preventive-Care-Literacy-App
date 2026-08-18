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

| Route                             | Description                                        |
| --------------------------------- | -------------------------------------------------- |
| `/prototype/school-configuration` | Local-only school configuration UI exploration     |
| All other routes                  | Prototype retirement notice; no Student data entry |

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

```bash
bun run verify:install
```

Generate API artifacts after changing an HTTP contract with `bun run generate:contracts`.
Apply forward migrations to an explicit database with
`DATABASE_URL=postgres://... bun run migrate`.

The immutable Google Cloud staging topology and its required controls are documented in
[`docs/operations/staging.md`](docs/operations/staging.md). CI deploys one digest to the
forward-migration job, same-origin web/API service, and private worker, then runs focused
security and provider smoke checks.

The API process must use a separate PostgreSQL login without `SUPERUSER` or `BYPASSRLS`;
the migration login is never reused at runtime. Starting the API also requires an
operator-only provisioning token of at least 32 characters and its audited identity:

```bash
DATABASE_URL=postgres://restricted-runtime-role/... \
OPERATOR_PROVISIONING_TOKEN=... \
OPERATOR_ID=operator@example.test \
bun apps/server/src/api.ts
```
