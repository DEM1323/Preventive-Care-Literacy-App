# Application-layer envelope adapter

Selected adapter: `application-layer-envelope/v1` in `packages/application-keys`. Intake Drafts and Intake Record Versions are sealed before they are admitted to PostgreSQL. The adapter is provider-neutral: it consumes wrapping-key bytes supplied by the API process and does not call a cloud KMS, Supabase Vault, or disk-encryption API.

## Threat assumptions

- A School Workspace dump, backup, replica, operator SQL session, or RLS bypass must not yield plaintext Student answers.
- Clinical and administrative HTTP projections must not receive those answers.
- Idempotency receipts may be stored, but they must not keep an unkeyed hash of low-entropy answers that can be guessed offline.

The adapter addresses those cases by encrypting each record with a random 256-bit data key, wrapping that data key with `APPLICATION_WRAPPING_KEY`, and binding AES-GCM AAD to `purpose:workspaceId:studentId`. Idempotency bindings are HMAC-SHA-256 under the same wrapping key, student-scoped, and stored without plaintext answers.

## Limits

`APPLICATION_WRAPPING_KEY` is a **process secret** in the API environment. Compromise of process memory, the environment, or a leaked wrapping key decrypts every record sealed under that key id. PostgreSQL access without that key does not.

Managed at-rest encryption and Supabase Vault are not equivalent: they protect provider disks and optional stored secrets, not application-layer ciphertext bound to a Student. A database role that can read `intake` rows still reads sealed bytes, not answers.

## Rotation, recovery, and exposure

- Each sealed row stores `wrapping_key_id`. Open uses that id; seal uses the active id. Keep retired wrapping keys available until every remaining record is re-sealed.
- Losing the wrapping key for a stored key id makes that ciphertext **unrecoverable**. There is no server-side recovery path.
- Rotating the active wrapping key does not rewrite existing rows. In-flight idempotency retries that were bound under a retired key may conflict and must use a new operation id only when no version was accepted yet.
- Process-secret exposure is an incident: rotate the wrapping key, treat sealed answers under the leaked id as disclosed, and revoke the leaked environment value.

This note is the threat-model verification for issue #28 criterion 1. It is not a regulatory assessment.
