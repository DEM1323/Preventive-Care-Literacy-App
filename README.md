# PrevCare — Preventive Care Literacy App

Multilingual static SPA for K-12 English Learners: health assessment, micro-lessons (Knowledge → Skills → Application), and a nurse dashboard with client-side encrypted submissions.

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS v4**
- **Bun** (package manager)
- **GitHub Pages** (static hosting)
- **Google Sheets + Apps Script** (CMS + encrypted submission store)

## Quick Start

```bash
bun install
bun run dev
```

Copy `.env.example` to `.env` for local Google Apps Script integration.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Hero / landing |
| `/sign-in` | Student sign-in |
| `/intake` | 6-step encrypted health history wizard |
| `/dashboard` | Learning module grid |
| `/module/:id` | K → S → A lesson view |
| `/profile` | Progress & badges |
| `/nurse` | Passcode-protected decrypt dashboard |

## Languages

English, Spanish, Portuguese, French, Haitian Creole

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

### 3. Add GitHub Actions secrets (for production API keys)

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Purpose |
|--------|---------|
| `VITE_GAS_SUBMIT_URL` | Google Apps Script Web App URL |
| `VITE_GAS_EXECUTION_TOKEN` | Apps Script execution token |
| `VITE_DISTRICT_ENCRYPTION_PASSCODE` | Client-side encryption passcode |
| `VITE_NURSE_DASHBOARD_PASSCODE` | Nurse dashboard gate passcode |
| `VITE_MODULES_SHEET_URL` | (Optional) Google Sheet CMS URL |

These are baked into the static build at deploy time. Never commit `.env` to the repo.

## Google Backend

See [`google-apps-script/README.md`](google-apps-script/README.md) for Apps Script deployment and Sheets setup.

Generate a token locally with:

```bash
python scripts/generate-execution-token.py
```
