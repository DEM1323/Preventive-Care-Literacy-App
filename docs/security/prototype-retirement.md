# Prototype Production Authority Retirement

This record implements issue #21. The prototype cannot process Student data and is not a production system. The remaining school-configuration UI is local-only and uses synthetic display content. The replacement application spine introduced by issue #22 is also synthetic-only until its later environment and release gates are complete; it does not restore authority to the prototype. Issue #28 added a server-authoritative synthetic Student Intake route on that replacement spine. Issue #29 added a server-authoritative synthetic Student Learning route on that replacement spine. Issue #30 added a separately authorized clinical directory and current Intake Record reveal on `/staff` for School Nurses with Clinical Permission; answers are returned only from `POST /api/v1/clinical/intake-records/current`, stay memory-only, and are not a restored prototype nurse dashboard. There is no runtime name or email content guard: School Workspace records do not carry a reliable synthetic-only flag, and a naming convention would be brittle. Staging operator process, controlled invitation delivery, and the synthetic fixture keep the environment synthetic.

## Browser credential inventory

All values supplied through these names must be treated as exposed because Vite embedded them in public browser artifacts.

| Former value                                               | Disposition                                                                      | Evidence                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `VITE_GAS_EXECUTION_TOKEN` / Apps Script `EXECUTION_TOKEN` | Retired. The browser and Apps Script no longer send, read, or authorize with it. | Removed from source, deploy workflow, and GitHub Actions secrets on 2026-08-18.            |
| `VITE_DISTRICT_ENCRYPTION_PASSCODE`                        | Retired with the Student-facing application and all intake storage code.         | Removed from source, templates, deploy workflow, and GitHub Actions secrets on 2026-08-18. |
| `VITE_NURSE_DASHBOARD_PASSCODE`                            | Retired. The browser-authenticated bulk read and `/nurse` route were removed.    | Removed from source, deploy workflow, and GitHub Actions secrets on 2026-08-18.            |

The Apps Script and published content-sheet URLs were also removed from browser deployment configuration. They are endpoints rather than credentials, but the retired browser has no reason to receive them.

## Local credential custody

On 2026-08-18, the ignored local environment file and untracked Google service-account JSON were moved without reading their values to `~/.config/prevcare/credentials/`. The directory is owner-only (`0700`) and both files are owner-readable only (`0600`). No credential-like file remains in the repository working tree.

`bun run check:security` fails if a credential-like file appears anywhere in the repository tree, if one is tracked, or if retired credential markers occur in browser source or built artifacts. The history scan in `.github/workflows/security.yml` provides the general secret scan.

## Environment exclusion

- All Google Apps Script source and manifest files are deleted from the repository.
- The browser receives no Google Apps Script endpoint or credential configuration.
- Prototype Google Student authentication, Student reads, and intake submissions remain deleted.
- The replacement spine exposes server-authoritative synthetic Student invitation redemption, session restoration, Intake Draft / Intake Record Version, Learning Item Completion, and the separately authorized clinical current-Intake-Record reveal. They do not restore the retired prototype or production authority.
- On first load after retirement, the browser deletes legacy Student email, intake, pending submission, and session state.
- Prototype-only Student-facing routes render a retirement notice. Replacement routes `/student/invitation`, `/student/sign-in`, `/student`, `/student/intake`, and `/student/learning` serve synthetic Students. Authenticated `/staff` can reveal one current synthetic Intake Record in memory under Clinical Permission; it is not Student answer entry and not the retired `/nurse` dashboard. `/operator` exchanges the server-only provisioning credential for a one-hour HttpOnly session and exposes only workspace setup metadata and commands; it does not expose Student or clinical records.

`bun run check:security` enforces the repository and browser-artifact boundary.

## Operator cutover evidence

GitHub Pages was unpublished and its remaining Apps Script URL secret was deleted on 2026-08-18. At retirement, this repository contained no replacement-backend implementation. Issue #22 subsequently introduced a Firebase/Google Cloud-portable backend spine with no Student data routes and no production authority.

The authorized operator completed the Google retirement procedure on 2026-08-18. See [the operator evidence](./prototype-retirement-evidence.md). `scripts/retire-google-prototype.sh` preserves the repeatable procedure.

1. Archive or delete every older web-app deployment that contains the legacy submission path.
2. Delete the obsolete Apps Script project and `EXECUTION_TOKEN` Script Property.
3. Permanently delete all approved prototype Sheets containing real Student data and their bound scripts, then record the deletion under the school's approved process.
4. Run `bun test`, `bun run typecheck`, `bun run build`, and `bun run check:security`; attach the outputs to the cutover record.

Every step above has a named operator, timestamp, and non-sensitive evidence. The legacy Google backend and its Student records are retired.
