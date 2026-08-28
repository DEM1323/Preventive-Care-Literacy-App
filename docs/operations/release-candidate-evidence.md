# School acceptance and release-candidate evidence

Issue #53 workflow for the Technical Operator. This repository produces a fail-closed evidence campaign. It does not invent live staging, provider-dashboard, or School Nurse results.

## What is automated versus pending

| Evidence                                                                                                                                                                | How it is produced                                                          | Default until recorded                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Campaign pin (digest, environment, schema, School Configuration Release, synthetic identity set)                                                                        | Operator API, `/operator`, or `scripts/run-release-candidate-acceptance.ts` | Required before any outcome is accepted |
| Success, denial, revocation, conflict, retry, restoration, content-change, governance, operational journeys that the golden/staging harness and spine tests can execute | Record `automated_synthetic` only after that exact digest actually ran      | `pending`                               |
| Controlled email and other live staging persistence                                                                                                                     | Golden journey / staging credentials against the pinned origin              | `live_staging_pending`                  |
| Backup/PITR provider dashboard                                                                                                                                          | `scripts/record-operational-provider-evidence.sh`                           | `provider_dashboard_pending`            |
| Chrome/Firefox desktop and mobile                                                                                                                                       | Playwright Chromium/Firefox, recorded as automation                         | `automated_synthetic` pending until run |
| Edge and Safari                                                                                                                                                         | Native human observation, or Chromium/WebKit named as `automation_proxy`    | `human_browser_pending`                 |
| Five locales and critical WCAG 2.2 AA                                                                                                                                   | Recorded outcomes; journey-blocking failures are non-waivable               | `pending`                               |
| School Nurse clinical reveal/clearing and domain authorization                                                                                                          | Wizard + `/operator` School Nurse acceptance                                | `school_nurse_pending` / `missing`      |

A campaign whose required checks are still pending evaluates as **pending**, not go. Authorization bypass, cross-workspace disclosure, sensitive-data leak, stale publication, false success, history/atomicity loss, failed required operations, and journey-blocking accessibility failures evaluate as **no-go** and cannot be waived.

## Pin and export

1. Deploy the exact candidate. Copy `artifactDigest` and `commit` from `/health/build`.
2. Run `scripts/run-release-candidate-acceptance-wizard.sh` for School Nurse and native browser steps. It stores non-secret confirmation values only.
3. Pin and export:

```bash
ACCEPTANCE_ARTIFACT_DIGEST=... \
ACCEPTANCE_COMMIT=... \
ACCEPTANCE_ENVIRONMENT_HOST=staging.up.railway.app \
ACCEPTANCE_RELEASE_ID=... \
ACCEPTANCE_IDENTITY_SET_ID=... \
bun scripts/run-release-candidate-acceptance.ts
```

When `PUBLIC_ORIGIN` and `OPERATOR_PROVISIONING_TOKEN` are set, the script also pins the campaign on staging. It never marks School Nurse, native Edge/Safari, or provider evidence passed unless the wizard recorded those outcomes.

4. Record automated journey outcomes through `POST /api/v1/operator/acceptance-campaigns/checks` after they actually ran against the pinned digest.
5. Export the bundle from `/operator` or `GET /api/v1/operator/acceptance-campaigns/current/evidence`.

Evidence may include opaque synthetic identifiers. It must not include Intake answers, invitation or sign-in codes, session handles, mailbox addresses, encryption material, package content, or protected telemetry.

Lower-risk exceptions need requirement, evidence, impact, mitigation, owner, expiry, and an explicit reason the finding is outside the non-waivable set. The Technical Operator owns go/no-go. School Nurse acceptance is mandatory.
