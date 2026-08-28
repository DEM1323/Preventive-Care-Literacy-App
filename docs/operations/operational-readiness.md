# Operational readiness and incident recovery

Production-shaped gates for the Technical Operator. Local and staging tests prove the contracts. Cloud backup schedules, PITR windows, and alert destinations still need provider-dashboard evidence; this repository does not invent that state.

Database restore is for corruption or data loss. It is not routine application rollback. After a restore, reapply retained purge manifests through the [purge restore gate](purge-restore-gate.md) before traffic resumes.

## Automated contracts versus provider evidence

| Gate                                                              | Automated local/staging proof                                                                                                | Human / provider step                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Daily backups and seven-day PITR                                  | Operator records evidence; restore resume stays closed until the record is `satisfied`                                       | Confirm the schedule and PITR window in the Supabase dashboard, then record the non-sensitive evidence         |
| Restore + purge reapplication                                     | Restore run + purge restore gate; readiness stays not-ready until the gate is `verified`                                     | Execute the provider restore against production-equivalent data, then run the purge restore gate               |
| Uptime, application-error, database-capacity, failed-email alerts | Adapter emits allowlisted kind/summary to `technical_operator`; acknowledgement is explicit                                  | Point Railway/uptime and provider monitors at the Technical Operator; never put Student content in the payload |
| Connection and resource caps                                      | `GET /api/v1/operator/service-caps` and fail-closed body/retry limits                                                        | Keep the application pool inside the Supabase plan limit                                                       |
| Forward migration / artifact rollback                             | `POST /api/v1/operator/artifact-rollback` returns schema-compatible rollback or roll-forward-only                            | Run forward migrations before code that depends on them; do not restore the database to roll back the app      |
| Task retry, operator repair, secret rotation, provider denial     | Retry/backoff caps, operator repair, incident revocation, deterministic vs transient denial                                  | Rotate process secrets in the host environment, then revoke through the incident drill                         |
| Incident drill                                                    | Stop, revoke sessions/secrets, preserve non-sensitive evidence, repair, rerun non-waivable checks, Technical Operator resume | Either Technical Operator or School Nurse may request stop; only the Technical Operator may authorize resume   |

Run `scripts/record-operational-provider-evidence.sh` for the dashboard steps the application cannot perform.

## Backup and restore

Required configuration: daily backups and at least seven days of point-in-time recovery.

1. Record backup evidence with `POST /api/v1/operator/backup-configuration`. Unsatisfied evidence cannot authorize restore resume.
2. Restore the snapshot with the API out of traffic (`PURGE_RESTORE_REQUIRED=1`).
3. Record the restore run with `POST /api/v1/operator/restore-runs`.
4. Reapply retained purge manifests (`POST /api/v1/operator/purge-restore-gate/begin` then `POST /api/v1/operator/purge-restore-gate`).
5. `GET /api/v1/operator/restore-readiness` must show `resume.allowed: true`. Missing or failed suppression proof keeps the service closed.

## Alerts and caps

Alert kinds: `uptime`, `application_error`, `database_capacity`, `failed_email`. Payloads keep kind, summary, destination, and acknowledgement only.

Explicit caps (also returned by `GET /api/v1/operator/service-caps`):

- API pool: 10 connections, 10s idle, 5s connect
- Request body: 64 KiB (worker internal body 1 KiB)
- Worker concurrency: 1
- Task retry: 5 attempts, 30s initial backoff, 15-minute cap
- Invitation challenge: 5 failed attempts

## Artifact rollback

Same schema: schema-compatible artifact rollback. Current schema ahead of the target along expand/contract migrations: schema-compatible rollback of the previous application. Target schema ahead or diverged: roll-forward-only. Restore is not this path.

## Incident drill

1. Stop — Technical Operator `POST /api/v1/operator/incidents/stop` or School Nurse `POST /api/v1/clinical/incident-stop-requests`.
2. During stop, new activity fail-closes (`INCIDENT_ACTIVITY_STOPPED`). `/health/*` and `/api/v1/operator/*` remain available. The Invitation worker skips delivery.
3. Revoke sessions and secrets — `POST /api/v1/operator/incidents/revocations` with the post-rotation wrapping and delivery key ids.
4. Preserve non-sensitive evidence — `POST /api/v1/operator/incidents/evidence`.
5. Repair the fault — operator repair and `POST /api/v1/operator/incidents/repairs`.
6. Rerun non-waivable checks — `POST /api/v1/operator/incidents/checks` (`purge_restore_gate`, `artifact_identity`, `secret_generation`, `backup_configuration`).
7. Resume — only the Technical Operator, with `confirmation: authorize_incident_resume`. Resume cannot bypass failed checks, stale secrets, purge obligations, or artifact identity.
