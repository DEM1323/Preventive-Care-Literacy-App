# Application-layer envelope adapter

Selected adapter: `application-layer-envelope/v1` in `packages/application-keys`. Intake Drafts and Intake Record Versions are sealed before they are admitted to PostgreSQL. The adapter is provider-neutral: it consumes wrapping-key bytes supplied by the API process and does not call a cloud KMS, Supabase Vault, or disk-encryption API.

## Threat assumptions

- A School Workspace dump, backup, replica, operator SQL session, or RLS bypass must not yield plaintext Student answers.
- Ordinary clinical and administrative HTTP projections must not receive those answers. That includes the clinical review directory, staff session and identity listings, class administration, and Student-facing intake/learning routes.
- The separately authorized, freshness-gated, no-store clinical reveal (`POST /api/v1/clinical/intake-records/current`) is the only HTTP seam that may return plaintext answers, and only after the current Staff Session, Clinical Permission, School Workspace, and password-plus-TOTP Authentication Freshness are locked and rechecked through ciphertext retrieval, in-process decrypt, and the append-only audit decision. The response must not be stored by caches, URLs, telemetry, or browser storage.
- Idempotency receipts may be stored, but they must not keep an unkeyed hash of low-entropy answers that can be guessed offline.
- A lost success response must replay the same accepted operation after wrapping-key rotation.

The adapter addresses those cases by encrypting each record with a random 256-bit data key, wrapping that data key with `APPLICATION_WRAPPING_KEY`, and binding AES-GCM AAD to `purpose:workspaceId:studentId`. Idempotency bindings are HMAC-SHA-256 under a separate `APPLICATION_IDEMPOTENCY_KEY`, student-scoped, and stored without plaintext answers or wrapping-key identifiers.

## Limits

`APPLICATION_WRAPPING_KEY` and `APPLICATION_IDEMPOTENCY_KEY` are **process secrets** in the API environment. Compromise of process memory, the environment, or a leaked wrapping key decrypts every record sealed under that key id. Compromise of the idempotency key lets an attacker compute bindings for guessed answers; it does not decrypt ciphertext. PostgreSQL access without those keys does not yield plaintext answers.

Managed at-rest encryption and Supabase Vault are not equivalent: they protect provider disks and optional stored secrets, not application-layer ciphertext bound to a Student. A database role that can read `intake` rows still reads sealed bytes, not answers.

## Rotation, recovery, and exposure

- Each sealed row stores `wrapping_key_id`. Open uses that id; seal uses the active id. Keep retired wrapping keys available until every remaining record is re-sealed.
- Losing the wrapping key for a stored key id makes that ciphertext **unrecoverable**. There is no server-side recovery path.
- Rotating `APPLICATION_WRAPPING_KEY` does not change stored idempotency bindings. `APPLICATION_IDEMPOTENCY_KEY` is rotated independently; keep it stable while in-flight retries of accepted operations may still arrive.
- Process-secret exposure is an incident: rotate the leaked wrapping or idempotency value, treat sealed answers under a leaked wrapping key id as disclosed, and revoke the leaked environment value.

This note is the threat-model verification for issue #28 criterion 1, updated for issue #30's authorized clinical reveal seam. It is not a regulatory assessment.
