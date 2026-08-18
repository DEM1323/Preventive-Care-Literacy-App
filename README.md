# PrevCare — Preventive Care Literacy App

Multilingual static prototype for K-12 English Learners: health intake and micro-lessons (Knowledge → Skills → Application).

> **Synthetic data only.** The prototype has no production authority. Never enter real Student information. See [the retirement and cutover record](docs/security/prototype-retirement.md).

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS v4**
- **Bun** (package manager)
- **GitHub Pages** (static hosting)
- **Google Apps Script tombstone** (retired Student-data boundary)

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

## Deploy to GitHub Pages

### 1. Create the GitHub repository

Create a new repo on GitHub (recommended name: `Preventive-Care-Literacy-App`).

Then from this folder:

```bash
git init
git add .
git commit -m "Initial commit: PrevCare literacy app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Preventive-Care-Literacy-App.git
git push -u origin main
```

### 2. Enable GitHub Pages

1. Open your repo on GitHub → **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions**
3. Push to `main` — the deploy workflow runs automatically

Your live URL will be:

`https://YOUR_USERNAME.github.io/Preventive-Care-Literacy-App/`

## Google Backend

See [`google-apps-script/README.md`](google-apps-script/README.md) for the fail-closed tombstone that must replace or delete every legacy Apps Script deployment.

## Verification

```bash
bun test
bun run typecheck
bun run build
bun run check:security
```
