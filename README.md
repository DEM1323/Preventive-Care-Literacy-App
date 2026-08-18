# PrevCare — Preventive Care Literacy App

Multilingual static prototype for K-12 English Learners: health intake and micro-lessons (Knowledge → Skills → Application).

> **Synthetic data only.** The prototype has no production authority. Never enter real Student information. See [the retirement and cutover record](docs/security/prototype-retirement.md).

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS v4**
- **Bun** (package manager)

## Quick Start

```bash
bun install
bun run dev
```

Keep local configuration outside the repository. For example, place it at `~/.config/prevcare/credentials/local.env`, then load it into the shell before starting Vite.

## Routes

| Route | Description |
|-------|-------------|
| `/prototype/school-configuration` | Local-only school configuration UI exploration |
| All other routes | Prototype retirement notice; no Student data entry |

## Verification

```bash
bun test
bun run typecheck
bun run build
bun run check:security
```
