# Purge restore gate and adapter verification

Database restore is not ordinary application rollback. After a snapshot is restored, disposed Student records must not re-enter active projections. Service readiness stays not-ready until this gate proves suppression.

## Restore runbook

1. Before restoring, export the durable purge ledger from `GET /api/v1/operator/purge-tombstones` (Operator Console: Export purge ledger). Retain that file outside the restored snapshot. It contains operational identifiers needed to reapply suppression, not Intake answers, addresses, codes, or ciphertext.
2. Restore the PostgreSQL snapshot. Keep the API process out of traffic. Set `PURGE_RESTORE_REQUIRED=1` before starting the API so `/health/ready` fail-closes until the gate returns `verified`. The restored database does not remember that a restore happened.
3. `POST /api/v1/operator/purge-restore-gate/begin` so the in-database gate is `pending`.
4. `POST /api/v1/operator/purge-restore-gate` with the retained `manifests`. Empty manifests after a pre-purge restore fail closed (`RESTORE_MANIFESTS_REQUIRED`). The gate must be `pending` or `failed` (`RESTORE_GATE_NOT_PENDING` otherwise). It imports tombstones, reapplies purge to each disposed Student, and verifies active projections are empty.
5. Resume traffic only after the gate returns `verified` and `/health/ready` returns 200. Then clear `PURGE_RESTORE_REQUIRED`.

A restore that cannot reapply manifests or still has unsuppressed disposed records stays `failed` and not-ready.

`/health/ready` also fail-closes when tombstones exist and a disposed Student still has owned projection data, even if the pending flag was not set. Restore-time deletes are authorized only while `reapply_purge_tombstone` holds a row in `records_governance.purge_restore_in_progress`, which the runtime login cannot write. Setting a session GUC is not enough.

## Adapter verification contract

Every declared persistence and subprocessor location reports `requested` / `deleted` / `pending` / `failed` deletion, `pending` / `verified` / `failed` verification, an opaque evidence digest when verified, and a residual-retention deadline.

| Adapter                                                                                                     | Location                             | Residual window | How verification is recorded                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity_access, memberships, intake, learning_progress, clinical_access_evidence, productions, projections | Primary database / owned projections | Immediate       | Completed during Record Disposition purge                                                                                                               |
| replicas                                                                                                    | Replica read models                  | 24 hours        | Starts pending. Reconcile against primary suppression.                                                                                                  |
| caches                                                                                                      | Application caches                   | 1 hour          | Starts pending. Reconcile; in-app caches are flushed.                                                                                                   |
| queues                                                                                                      | Task queues                          | 7 days          | Starts pending. Reconcile; no identifying payloads retained.                                                                                            |
| telemetry                                                                                                   | Telemetry / log retention            | 30 days         | Starts pending. Reconcile; no Student content in telemetry.                                                                                             |
| object_storage                                                                                              | Object / blob storage                | 7 days          | Starts pending. Reconcile; generated Record Production ciphertext must be absent.                                                                       |
| email_provider                                                                                              | Email subprocessor residue           | 30 days         | Starts pending. Administrator records `provider_deletion_verified` with an opaque digest. The application does not claim unsupported provider deletion. |
| backups                                                                                                     | Backup media                         | 30 days         | Starts pending. Administrator records `backup_expiry_verified` only after the window ends.                                                              |

Missing adapters, missed deadlines, failures, and unverifiable locations remain actionable on the Administrator Record Disposition view and block the destruction certificate.

## Destruction certificate

`POST /api/v1/administration/students/record-destruction-certificates` issues a certificate only after the disposition is purged and every required location is verified. Creation is atomic and idempotent. Pending, failed, or late locations return `DESTRUCTION_CERTIFICATE_NOT_ISSUABLE` with adapter status only.

The certificate retains certificate id, issued-at, policy revision, disposition id, and verified adapter summaries. It never includes Student identifiers, addresses, answers, codes, ciphertext, generated package contents, or free text.

Identifying verification workflow residue is discarded at issuance (`student_id` cleared on `purge_identifying_residue`). Durable non-identifying evidence kept: purge tombstones, purge manifests, verification location rows, disposition events, and the certificate.
