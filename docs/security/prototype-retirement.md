# Prototype Production Authority Retirement

This record implements issue #21. The prototype cannot process Student data and is not a production system. The remaining school-configuration UI is local-only and uses synthetic display content.

## Browser credential inventory

All values supplied through these names must be treated as exposed because Vite embedded them in public browser artifacts.

| Former value | Disposition | Evidence |
|---|---|---|
| `VITE_GAS_EXECUTION_TOKEN` / Apps Script `EXECUTION_TOKEN` | Retired. The browser and Apps Script no longer send, read, or authorize with it. | Removed from source, deploy workflow, and GitHub Actions secrets on 2026-08-18. |
| `VITE_DISTRICT_ENCRYPTION_PASSCODE` | Retired with the Student-facing application and all intake storage code. | Removed from source, templates, deploy workflow, and GitHub Actions secrets on 2026-08-18. |
| `VITE_NURSE_DASHBOARD_PASSCODE` | Retired. The browser-authenticated bulk read and `/nurse` route were removed. | Removed from source, deploy workflow, and GitHub Actions secrets on 2026-08-18. |

The Apps Script and published content-sheet URLs were also removed from browser deployment configuration. They are endpoints rather than credentials, but the retired browser has no reason to receive them.

## Local credential custody

On 2026-08-18, the ignored local environment file and untracked Google service-account JSON were moved without reading their values to `~/.config/prevcare/credentials/`. The directory is owner-only (`0700`) and both files are owner-readable only (`0600`). No credential-like file remains in the repository working tree.

`bun run check:security` fails if a credential-like file appears anywhere in the repository tree, if one is tracked, or if retired credential markers occur in browser source or built artifacts. The history scan in `.github/workflows/security.yml` provides the general secret scan.

## Environment guard

Apps Script requests fail closed unless Script Property `DATA_POLICY` is exactly `synthetic-only`. Even in that mode:

- The only allowed request is `GET ?action=health`.
- Student authentication, Student reads, and intake submissions are disabled.
- The Apps Script manifest grants no Google OAuth scopes.
- On first load after retirement, the browser deletes legacy Student email, intake, pending submission, and session state.
- The unauthenticated legacy submission shape and every other request are rejected.
- Student-facing routes render a retirement notice; only the local-only school-configuration UI prototype remains available.

The request-boundary behavior is covered by `tests/google-apps-script.test.ts`.

## Operator cutover evidence

GitHub Pages was unpublished and its remaining Apps Script URL secret was deleted on 2026-08-18. Before enabling any Apps Script deployment from this repository:

Run `scripts/retire-google-prototype.sh` to walk the authorized Google operator through these steps and generate a non-sensitive evidence record.

1. Delete or disable every older web-app deployment that contains the legacy submission path.
2. Replace `Code.gs`, create a new deployment version, and set `DATA_POLICY=synthetic-only`.
3. Delete the obsolete `EXECUTION_TOKEN` Script Property.
4. Delete all prototype sheets containing real Student data and record the deletion under the school's approved process.
5. Confirm `GET ?action=health` returns `{"status":"ok","dataPolicy":"synthetic-only"}` without a token.
6. Confirm every POST and every non-health GET is rejected.
7. Run `bun test`, `bun run typecheck`, `bun run build`, and `bun run check:security`; attach the outputs to the cutover record.

Go is permitted only when every step above has named operator, timestamp, and evidence. Otherwise the prototype backend remains retired by its fail-closed default.
