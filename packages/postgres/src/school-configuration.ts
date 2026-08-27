import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import {
  ActiveReleaseConflictError,
  AuthenticationFreshnessRequiredError,
  CandidateFingerprintConflictError,
  DraftVersionConflictError,
  errorFromPublicationFailure,
  InvalidSchoolConfigurationError,
  OperationIdReusedError,
  ResourceRevisionConflictError,
  type ImportSchoolConfigurationDraftResult,
  type PublishSchoolConfigurationReleaseResult,
  type PublicationFailure,
  type SchoolConfigurationStore,
} from '../../../modules/school-configuration/index.ts';
import {
  AdministrativePermissionRequiredError,
  StaffAuthenticationFailedError,
  staffAuthenticationFreshnessMs,
} from '../../../modules/identity-access/index.ts';
import { schoolConfigurationWorkspaceLockKey } from './workspace-locks.ts';

async function setScope(
  client: PoolClient,
  workspaceId: string,
  staffIdentityId: string,
  sessionHandleHash?: string,
): Promise<void> {
  await client.query("select set_config('app.workspace_id', $1, true)", [
    workspaceId,
  ]);
  await client.query("select set_config('app.staff_identity_id', $1, true)", [
    staffIdentityId,
  ]);
  if (sessionHandleHash) {
    await client.query(
      "select set_config('app.session_handle_hash', $1, true)",
      [sessionHandleHash],
    );
  }
}

async function transaction<Result>(
  pool: Pool,
  run: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const scopedClient = publicationConnection.getStore();
  const client = scopedClient ?? (await pool.connect());
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    if (!scopedClient) client.release();
  }
}

const publicationConnection = new AsyncLocalStorage<PoolClient>();

async function readReleaseRows(
  client: PoolClient,
  workspaceId: string,
  releaseId?: string,
) {
  const result = await client.query<{
    release_id: string;
    release_number: string;
    candidate_fingerprint: string;
    change_description: string;
    published_at: Date;
    published_by: string;
    active: boolean;
    resource_id: string | null;
    revision_number: number | null;
    slot: string | null;
    resource_kind: string | null;
    position: number | null;
  }>(
    `select release.release_id, release.release_number, release.candidate_fingerprint,
            release.change_description, release.published_at, release.published_by,
            release.release_id = state.active_release_id as active,
            component.resource_id, component.revision_number, component.slot,
            resource.resource_kind, component.position
       from school_configuration.configuration_states state
       join school_configuration.configuration_releases release
         on release.workspace_id = state.workspace_id
       left join school_configuration.release_components component
         on component.release_id = release.release_id
        and component.workspace_id = release.workspace_id
       left join school_configuration.authored_resources resource
         on resource.workspace_id = component.workspace_id
        and resource.resource_id = component.resource_id
      where state.workspace_id = $1
        and ($2::uuid is null or release.release_id = $2)
      order by release.release_number desc, component.slot, component.resource_id`,
    [workspaceId, releaseId ?? null],
  );
  const releases = new Map<
    string,
    {
      releaseId: string;
      releaseNumber: number;
      candidateFingerprint: string;
      changeDescription: string;
      publishedAt: Date;
      publishedBy: string;
      active: boolean;
      components: {
        resourceId: string;
        revisionNumber: number;
        slot: string;
        kind: string;
        position: number | null;
      }[];
    }
  >();
  for (const row of result.rows) {
    const current = releases.get(row.release_id) ?? {
      releaseId: row.release_id,
      releaseNumber: Number(row.release_number),
      candidateFingerprint: row.candidate_fingerprint,
      changeDescription: row.change_description,
      publishedAt: row.published_at,
      publishedBy: row.published_by,
      active: row.active,
      components: [],
    };
    if (row.resource_id && row.revision_number != null && row.slot) {
      current.components.push({
        resourceId: row.resource_id,
        revisionNumber: row.revision_number,
        slot: row.slot,
        kind: row.resource_kind ?? 'resource',
        position: row.position,
      });
    }
    releases.set(row.release_id, current);
  }
  return [...releases.values()];
}

export function createPostgresSchoolConfigurationStore(options: {
  pool: Pool;
  hashSessionHandle(handle: string): string;
}): SchoolConfigurationStore {
  return {
    async withPublicationLock(input) {
      const client = await options.pool.connect();
      const key = `${input.workspaceId}:${input.operationId}`;
      try {
        await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [
          key,
        ]);
        return await publicationConnection.run(client, input.run);
      } finally {
        await client
          .query('select pg_advisory_unlock(hashtextextended($1, 0))', [key])
          .finally(() => client.release());
      }
    },

    async withPackageLock(input) {
      const scopedClient = publicationConnection.getStore();
      const client = scopedClient ?? (await options.pool.connect());
      const key = `${input.workspaceId}:${input.packageDigest}`;
      try {
        await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [
          key,
        ]);
        return await input.run();
      } finally {
        await client.query(
          'select pg_advisory_unlock(hashtextextended($1, 0))',
          [key],
        );
        if (!scopedClient) client.release();
      }
    },

    async readDraft(session) {
      return transaction(options.pool, async (client) => {
        await setScope(client, session.workspaceId, session.staffIdentityId);
        const result = await client.query<{
          draft_version: string;
          active_release_id: string | null;
          active_release_number: string | null;
          active_candidate_fingerprint: string | null;
          candidate: unknown;
          candidate_fingerprint: string;
        }>(
          `select state.draft_version, state.active_release_id,
                  release.release_number as active_release_number,
                  release.candidate_fingerprint as active_candidate_fingerprint,
                  draft.candidate, draft.candidate_fingerprint
             from school_configuration.configuration_states state
             join school_configuration.draft_candidates draft using (workspace_id)
             left join school_configuration.configuration_releases release
               on release.release_id = state.active_release_id
            where state.workspace_id = $1`,
          [session.workspaceId],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        return {
          workspaceId: session.workspaceId,
          draftVersion: Number(row.draft_version),
          activeReleaseId: row.active_release_id,
          activeReleaseNumber: row.active_release_number
            ? Number(row.active_release_number)
            : null,
          activeCandidateFingerprint: row.active_candidate_fingerprint,
          candidateFingerprint: row.candidate_fingerprint,
          candidate: row.candidate,
        };
      });
    },

    async readActiveReleaseResources(session) {
      return transaction(options.pool, async (client) => {
        await setScope(client, session.workspaceId, session.staffIdentityId);
        const result = await client.query<{
          resource_id: string;
          revision_number: number;
          resource_kind: string;
          slot: string;
          position: number | null;
          payload: Record<string, unknown>;
        }>(
          `select component.resource_id, component.revision_number,
                  resource.resource_kind, component.slot, component.position,
                  revision.payload
             from school_configuration.configuration_states state
             join school_configuration.release_components component
               on component.release_id = state.active_release_id
              and component.workspace_id = state.workspace_id
             join school_configuration.authored_resources resource
               on resource.workspace_id = component.workspace_id
              and resource.resource_id = component.resource_id
             join school_configuration.authored_revisions revision
               on revision.workspace_id = component.workspace_id
              and revision.resource_id = component.resource_id
              and revision.revision_number = component.revision_number
            where state.workspace_id = $1 and state.active_release_id is not null`,
          [session.workspaceId],
        );
        return result.rows.map((row) => ({
          resourceId: row.resource_id,
          revisionNumber: row.revision_number,
          kind: row.resource_kind,
          slot: row.slot,
          position: row.position,
          payload: row.payload,
        }));
      });
    },

    async readReferencedResourceIds(session) {
      return transaction(options.pool, async (client) => {
        await setScope(client, session.workspaceId, session.staffIdentityId);
        const result = await client.query<{ resource_id: string }>(
          `select distinct resource_id
             from school_configuration.release_components
            where workspace_id = $1`,
          [session.workspaceId],
        );
        return result.rows.map((row) => row.resource_id);
      });
    },

    async readOccupiedRevisions(session) {
      return transaction(options.pool, async (client) => {
        await setScope(client, session.workspaceId, session.staffIdentityId);
        const result = await client.query<{
          resource_id: string;
          revision_number: number;
        }>(
          `select resource_id, revision_number
             from school_configuration.authored_revisions
            where workspace_id = $1`,
          [session.workspaceId],
        );
        return result.rows.map((row) => ({
          resourceId: row.resource_id,
          revisionNumber: row.revision_number,
        }));
      });
    },

    async listReleases(session) {
      return transaction(options.pool, async (client) => {
        await setScope(client, session.workspaceId, session.staffIdentityId);
        return readReleaseRows(client, session.workspaceId);
      });
    },

    async readRelease(session, releaseId) {
      return transaction(options.pool, async (client) => {
        await setScope(client, session.workspaceId, session.staffIdentityId);
        const releases = await readReleaseRows(
          client,
          session.workspaceId,
          releaseId,
        );
        const summary = releases[0];
        if (!summary) return undefined;
        const assembly = await client.query<{ candidate: unknown }>(
          `select candidate
             from school_configuration.release_assemblies
            where workspace_id = $1 and release_id = $2`,
          [session.workspaceId, releaseId],
        );
        const candidate = assembly.rows[0]?.candidate;
        if (candidate === undefined) return undefined;
        return { ...summary, candidate };
      });
    },

    async saveDraft(input) {
      return transaction(options.pool, async (client) => {
        await setScope(
          client,
          input.session.workspaceId,
          input.session.staffIdentityId,
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${input.session.workspaceId}:${input.operationId}`],
        );
        const receipt = await client.query<{
          request_fingerprint: string | null;
          result: { draftVersion: number };
        }>(
          `select request_fingerprint, result
             from infrastructure.operation_receipts
            where workspace_id = $1 and operation_id = $2`,
          [input.session.workspaceId, input.operationId],
        );
        if (receipt.rows[0]) {
          if (
            receipt.rows[0].request_fingerprint !== input.requestFingerprint
          ) {
            throw new OperationIdReusedError();
          }
          return receipt.rows[0].result;
        }
        const state = await client.query<{ draft_version: string }>(
          `select draft_version from school_configuration.configuration_states
            where workspace_id = $1 for update`,
          [input.session.workspaceId],
        );
        const currentVersion = Number(state.rows[0]?.draft_version ?? 0);
        if (currentVersion !== input.expectedDraftVersion) {
          throw new DraftVersionConflictError(currentVersion);
        }
        for (const expected of input.expectedResourceRevisions) {
          const current = await client.query<{ revision_number: number }>(
            `select revision_number from school_configuration.draft_components
              where workspace_id = $1 and resource_id = $2`,
            [input.session.workspaceId, expected.resourceId],
          );
          if (current.rows[0]?.revision_number !== expected.revisionNumber) {
            throw new ResourceRevisionConflictError();
          }
        }
        if (input.discardedResourceIds.length > 0) {
          const published = await client.query<{ resource_id: string }>(
            `select distinct resource_id
               from school_configuration.release_components
              where workspace_id = $1 and resource_id = any($2::uuid[])`,
            [input.session.workspaceId, input.discardedResourceIds],
          );
          if (published.rows.length > 0) {
            throw new InvalidSchoolConfigurationError('discard');
          }
        }
        await client.query(
          `delete from school_configuration.draft_components
            where workspace_id = $1`,
          [input.session.workspaceId],
        );
        const resourceRows = JSON.stringify(
          input.resources.map((resource) => ({
            resource_id: resource.resourceId,
            revision_number: resource.revisionNumber,
            kind: resource.kind,
            slot: resource.slot,
            position: resource.position,
            payload: resource.payload,
          })),
        );
        await client.query(
          `insert into school_configuration.authored_resources
             (workspace_id, resource_id, resource_kind)
           select $1, resource_id, kind
             from jsonb_to_recordset($2::jsonb) as x(
               resource_id uuid, revision_number integer, kind text,
               slot text, position integer, payload jsonb
             )
           on conflict (workspace_id, resource_id) do nothing`,
          [input.session.workspaceId, resourceRows],
        );
        await client.query(
          `update school_configuration.authored_revisions revision
              set lifecycle = 'frozen'
             from jsonb_to_recordset($2::jsonb) as x(
               resource_id uuid, revision_number integer, kind text,
               slot text, position integer, payload jsonb
             )
            where revision.workspace_id = $1
              and revision.resource_id = x.resource_id
              and revision.revision_number <> x.revision_number
              and revision.lifecycle = 'working'`,
          [input.session.workspaceId, resourceRows],
        );
        await client.query(
          `update school_configuration.authored_revisions revision
              set payload = x.payload, authored_by = $3, authored_at = $4
             from jsonb_to_recordset($2::jsonb) as x(
               resource_id uuid, revision_number integer, kind text,
               slot text, position integer, payload jsonb
             )
            where revision.workspace_id = $1
              and revision.resource_id = x.resource_id
              and revision.revision_number = x.revision_number
              and revision.lifecycle = 'working'`,
          [
            input.session.workspaceId,
            resourceRows,
            input.session.staffIdentityId,
            input.changedAt,
          ],
        );
        await client.query(
          `insert into school_configuration.authored_revisions
             (workspace_id, resource_id, revision_number, lifecycle,
              payload_schema_version, payload, authored_by, authored_at)
           select $1, x.resource_id, x.revision_number, 'working', 1, x.payload, $3, $4
             from jsonb_to_recordset($2::jsonb) as x(
               resource_id uuid, revision_number integer, kind text,
               slot text, position integer, payload jsonb
             )
            where not exists (
              select 1 from school_configuration.authored_revisions revision
               where revision.workspace_id = $1
                 and revision.resource_id = x.resource_id
                 and revision.revision_number = x.revision_number
            )`,
          [
            input.session.workspaceId,
            resourceRows,
            input.session.staffIdentityId,
            input.changedAt,
          ],
        );
        await client.query(
          `insert into school_configuration.draft_components
             (workspace_id, resource_id, revision_number, slot, position)
           select $1, x.resource_id, x.revision_number, x.slot, x.position
             from jsonb_to_recordset($2::jsonb) as x(
               resource_id uuid, revision_number integer, kind text,
               slot text, position integer, payload jsonb
             )`,
          [input.session.workspaceId, resourceRows],
        );
        if (input.discardedResourceIds.length > 0) {
          await client.query(
            `delete from school_configuration.managed_translation_reviews
              where workspace_id = $1
                and (source_resource_id = any($2::uuid[])
                 or translation_resource_id = any($2::uuid[]))`,
            [input.session.workspaceId, input.discardedResourceIds],
          );
          await client.query(
            `delete from school_configuration.authored_revisions
              where workspace_id = $1 and resource_id = any($2::uuid[])
                and lifecycle = 'working'`,
            [input.session.workspaceId, input.discardedResourceIds],
          );
          await client.query(
            `delete from school_configuration.authored_resources resource
              where workspace_id = $1 and resource_id = any($2::uuid[])
                and not exists (
                  select 1 from school_configuration.authored_revisions revision
                   where revision.workspace_id = resource.workspace_id
                     and revision.resource_id = resource.resource_id
                )`,
            [input.session.workspaceId, input.discardedResourceIds],
          );
        }
        if (input.archivedResourceIds.length > 0) {
          await client.query(
            `update school_configuration.authored_resources
                set archived_at = $3
              where workspace_id = $1 and resource_id = any($2::uuid[])`,
            [
              input.session.workspaceId,
              input.archivedResourceIds,
              input.changedAt,
            ],
          );
          await client.query(
            `update school_configuration.authored_revisions
                set lifecycle = 'frozen'
              where workspace_id = $1
                and resource_id = any($2::uuid[])
                and lifecycle = 'working'`,
            [input.session.workspaceId, input.archivedResourceIds],
          );
        }
        if (input.resources.length > 0) {
          await client.query(
            `update school_configuration.authored_resources
                set archived_at = null
              where workspace_id = $1
                and resource_id = any($2::uuid[])
                and archived_at is not null`,
            [
              input.session.workspaceId,
              input.resources.map((resource) => resource.resourceId),
            ],
          );
        }
        if (input.reviews.length > 0) {
          await client.query(
            `insert into school_configuration.managed_translation_reviews
               (workspace_id, source_resource_id, source_revision_number,
                translation_resource_id, translation_revision_number, locale,
                review_provenance_id, reviewer, reviewed_at)
             select $1, source_resource_id, source_revision_number,
                    translation_resource_id, translation_revision_number, locale,
                    review_provenance_id, reviewer, reviewed_at
               from jsonb_to_recordset($2::jsonb) as x(
                 source_resource_id uuid, source_revision_number integer,
                 translation_resource_id uuid, translation_revision_number integer,
                 locale text, review_provenance_id uuid, reviewer text,
                 reviewed_at timestamptz
               )
             on conflict do nothing`,
            [
              input.session.workspaceId,
              JSON.stringify(
                input.reviews.map((review) => ({
                  source_resource_id: review.sourceResourceId,
                  source_revision_number: review.sourceRevisionNumber,
                  translation_resource_id: review.translationResourceId,
                  translation_revision_number: review.translationRevisionNumber,
                  locale: review.locale,
                  review_provenance_id: review.reviewProvenanceId,
                  reviewer: review.reviewer,
                  reviewed_at: review.reviewedAt.toISOString(),
                })),
              ),
            ],
          );
        }
        await client.query(
          `insert into school_configuration.draft_candidates
             (workspace_id, candidate, candidate_fingerprint, updated_by, updated_at)
           values ($1, $2, $3, $4, $5)
           on conflict (workspace_id) do update
             set candidate = excluded.candidate,
                 candidate_fingerprint = excluded.candidate_fingerprint,
                 updated_by = excluded.updated_by,
                 updated_at = excluded.updated_at`,
          [
            input.session.workspaceId,
            input.candidate,
            input.candidateFingerprint,
            input.session.staffIdentityId,
            input.changedAt,
          ],
        );
        const result = { draftVersion: currentVersion + 1 };
        await client.query(
          `update school_configuration.configuration_states
              set draft_version = $2 where workspace_id = $1`,
          [input.session.workspaceId, result.draftVersion],
        );
        await client.query(
          `insert into infrastructure.operation_receipts
             (workspace_id, operation_id, command_name, result,
              request_fingerprint, recorded_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, 'editSchoolConfigurationDraft', $3, $4, $5,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            input.session.workspaceId,
            input.operationId,
            result,
            input.requestFingerprint,
            input.changedAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, details, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'school_configuration_draft.edited',
                   'staff', $4, $5, $6, 'school', 'audit_evidence',
                   'workspace_audit_evidence')`,
          [
            input.auditId,
            input.session.workspaceId,
            input.operationId,
            input.session.staffIdentityId,
            input.changedAt,
            {
              candidateFingerprint: input.candidateFingerprint,
              discardedResourceIds: input.discardedResourceIds,
              archivedResourceIds: input.archivedResourceIds,
            },
          ],
        );
        return result;
      });
    },

    async importDraft(input) {
      return transaction(options.pool, async (client) => {
        await setScope(
          client,
          input.session.workspaceId,
          input.session.staffIdentityId,
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${input.session.workspaceId}:${input.operationId}`],
        );
        const receipt = await client.query<{
          request_fingerprint: string | null;
          result: ImportSchoolConfigurationDraftResult;
        }>(
          `select request_fingerprint, result
             from infrastructure.operation_receipts
            where workspace_id = $1 and operation_id = $2`,
          [input.session.workspaceId, input.operationId],
        );
        if (receipt.rows[0]) {
          if (
            receipt.rows[0].request_fingerprint !== input.requestFingerprint
          ) {
            throw new OperationIdReusedError();
          }
          return receipt.rows[0].result;
        }
        await client.query(
          `insert into school_configuration.configuration_states (workspace_id)
           values ($1) on conflict (workspace_id) do nothing`,
          [input.session.workspaceId],
        );
        const state = await client.query<{ draft_version: string }>(
          `select draft_version from school_configuration.configuration_states
            where workspace_id = $1 for update`,
          [input.session.workspaceId],
        );
        const currentVersion = Number(state.rows[0]?.draft_version ?? 0);
        if (currentVersion !== input.expectedDraftVersion) {
          throw new DraftVersionConflictError(currentVersion);
        }
        await client.query(
          `delete from school_configuration.draft_components
            where workspace_id = $1`,
          [input.session.workspaceId],
        );
        for (const resource of input.resources) {
          await client.query(
            `insert into school_configuration.authored_resources
               (workspace_id, resource_id, resource_kind)
             values ($1, $2, $3)
             on conflict (workspace_id, resource_id) do nothing`,
            [input.session.workspaceId, resource.resourceId, resource.kind],
          );
          const existingRevision = await client.query<{ matches: boolean }>(
            `select payload = $4::jsonb as matches
               from school_configuration.authored_revisions
              where workspace_id = $1 and resource_id = $2
                and revision_number = $3`,
            [
              input.session.workspaceId,
              resource.resourceId,
              resource.revisionNumber,
              resource.payload,
            ],
          );
          if (existingRevision.rows[0]?.matches === false) {
            throw new ResourceRevisionConflictError();
          }
          await client.query(
            `delete from school_configuration.authored_revisions
              where workspace_id = $1 and resource_id = $2
                and revision_number <> $3 and lifecycle = 'working'`,
            [
              input.session.workspaceId,
              resource.resourceId,
              resource.revisionNumber,
            ],
          );
          await client.query(
            `insert into school_configuration.authored_revisions
               (workspace_id, resource_id, revision_number, lifecycle,
                payload_schema_version, payload, authored_by, authored_at)
             values ($1, $2, $3, 'working', 1, $4, $5, $6)
             on conflict (workspace_id, resource_id, revision_number) do nothing`,
            [
              input.session.workspaceId,
              resource.resourceId,
              resource.revisionNumber,
              resource.payload,
              input.session.staffIdentityId,
              input.changedAt,
            ],
          );
          await client.query(
            `insert into school_configuration.draft_components
               (workspace_id, resource_id, revision_number, slot, position)
             values ($1, $2, $3, $4, $5)
             on conflict (workspace_id, resource_id, revision_number) do update
               set slot = excluded.slot, position = excluded.position`,
            [
              input.session.workspaceId,
              resource.resourceId,
              resource.revisionNumber,
              resource.slot,
              resource.position,
            ],
          );
        }
        for (const review of input.reviews) {
          await client.query(
            `insert into school_configuration.managed_translation_reviews
               (workspace_id, source_resource_id, source_revision_number,
                translation_resource_id, translation_revision_number, locale,
                review_provenance_id, reviewer, reviewed_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict do nothing`,
            [
              input.session.workspaceId,
              review.sourceResourceId,
              review.sourceRevisionNumber,
              review.translationResourceId,
              review.translationRevisionNumber,
              review.locale,
              review.reviewProvenanceId,
              review.reviewer,
              review.reviewedAt,
            ],
          );
        }
        await client.query(
          `insert into school_configuration.draft_candidates
             (workspace_id, candidate, candidate_fingerprint, updated_by, updated_at)
           values ($1, $2, $3, $4, $5)
           on conflict (workspace_id) do update
             set candidate = excluded.candidate,
                 candidate_fingerprint = excluded.candidate_fingerprint,
                 updated_by = excluded.updated_by,
                 updated_at = excluded.updated_at`,
          [
            input.session.workspaceId,
            input.candidate,
            input.candidateFingerprint,
            input.session.staffIdentityId,
            input.changedAt,
          ],
        );
        const result: ImportSchoolConfigurationDraftResult = {
          operationId: input.operationId,
          draftVersion: currentVersion + 1,
          candidateFingerprint: input.candidateFingerprint,
          affectedResources: input.resources.map((resource) => ({
            resourceId: resource.resourceId,
            revisionNumber: resource.revisionNumber,
          })),
        };
        await client.query(
          `update school_configuration.configuration_states
              set draft_version = $2 where workspace_id = $1`,
          [input.session.workspaceId, result.draftVersion],
        );
        await client.query(
          `insert into infrastructure.operation_receipts
             (workspace_id, operation_id, command_name, result,
              request_fingerprint, recorded_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, 'importSchoolConfigurationDraft', $3, $4, $5,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            input.session.workspaceId,
            input.operationId,
            result,
            input.requestFingerprint,
            input.changedAt,
          ],
        );
        return result;
      });
    },

    async preparePublication(input) {
      return transaction(options.pool, async (client) => {
        await setScope(
          client,
          input.session.workspaceId,
          input.session.staffIdentityId,
        );
        const existing = await client.query<{
          request_fingerprint: string;
          proposed_release_id: string;
          status: string;
          result:
            PublishSchoolConfigurationReleaseResult | PublicationFailure | null;
        }>(
          `select request_fingerprint, proposed_release_id, status, result
             from school_configuration.publication_attempts
            where workspace_id = $1 and operation_id = $2`,
          [input.session.workspaceId, input.operationId],
        );
        const attempt = existing.rows[0];
        if (attempt) {
          if (attempt.request_fingerprint !== input.requestFingerprint) {
            throw new OperationIdReusedError();
          }
          if (attempt.status === 'succeeded' && attempt.result) {
            return {
              outcome: 'replayed',
              result: attempt.result as PublishSchoolConfigurationReleaseResult,
            } as const;
          }
          if (attempt.status === 'failed' && attempt.result) {
            throw errorFromPublicationFailure(
              attempt.result as PublicationFailure,
            );
          }
          return {
            outcome: 'prepared',
            releaseId: attempt.proposed_release_id,
          } as const;
        }
        await client.query(
          `insert into school_configuration.publication_attempts
             (workspace_id, operation_id, request_fingerprint,
              proposed_release_id, status, created_at, updated_at)
           values ($1, $2, $3, $4, 'preparing', $5, $5)`,
          [
            input.session.workspaceId,
            input.operationId,
            input.requestFingerprint,
            input.proposedReleaseId,
            input.preparedAt,
          ],
        );
        return {
          outcome: 'prepared',
          releaseId: input.proposedReleaseId,
        } as const;
      });
    },

    async recordPublicationFailure(input) {
      await transaction(options.pool, async (client) => {
        await setScope(
          client,
          input.session.workspaceId,
          input.session.staffIdentityId,
        );
        await client.query(
          `update school_configuration.publication_attempts
              set status = 'failed', result = $4, updated_at = $5
            where workspace_id = $1 and operation_id = $2
              and request_fingerprint = $3 and status = 'preparing'`,
          [
            input.session.workspaceId,
            input.operationId,
            input.requestFingerprint,
            input.failure,
            input.failedAt,
          ],
        );
      });
    },

    async activatePublication(input) {
      return transaction(options.pool, async (client) => {
        const sessionHandleHash = options.hashSessionHandle(
          input.sessionHandle,
        );
        await setScope(
          client,
          input.session.workspaceId,
          input.session.staffIdentityId,
          sessionHandleHash,
        );
        const attemptResult = await client.query<{
          request_fingerprint: string;
          status: string;
          result: PublishSchoolConfigurationReleaseResult | null;
        }>(
          `select request_fingerprint, status, result
             from school_configuration.publication_attempts
            where workspace_id = $1 and operation_id = $2 for update`,
          [input.session.workspaceId, input.operationId],
        );
        const attempt = attemptResult.rows[0];
        if (
          !attempt ||
          attempt.request_fingerprint !== input.requestFingerprint
        ) {
          throw new OperationIdReusedError();
        }
        if (attempt.status === 'succeeded' && attempt.result) {
          return { ...attempt.result, replayed: true };
        }
        const sessionResult = await client.query<{
          expires_at: Date;
          revoked_at: Date | null;
          authenticated_at: Date;
          refreshed_at: Date | null;
          active: boolean;
          administrative: boolean;
        }>(
          `select session.expires_at, session.revoked_at, session.authenticated_at,
                  freshness.refreshed_at, identity.status = 'active' as active,
                  identity_access.current_staff_has_permission('administrative') as administrative
             from identity_access.staff_sessions session
             join identity_access.staff_identities identity
               on identity.staff_identity_id = session.staff_identity_id
              and identity.workspace_id = session.workspace_id
             left join identity_access.staff_session_freshness freshness
               on freshness.session_id = session.session_id
            where session.session_id = $1 and session.workspace_id = $2
              and session.staff_identity_id = $3`,
          [
            input.session.sessionId,
            input.session.workspaceId,
            input.session.staffIdentityId,
          ],
        );
        const currentSession = sessionResult.rows[0];
        if (
          !currentSession ||
          currentSession.revoked_at ||
          currentSession.expires_at <= input.publishedAt ||
          !currentSession.active
        ) {
          throw new StaffAuthenticationFailedError();
        }
        if (!currentSession.administrative) {
          throw new AdministrativePermissionRequiredError();
        }
        const freshAt =
          currentSession.refreshed_at ?? currentSession.authenticated_at;
        if (
          input.publishedAt.getTime() - freshAt.getTime() >=
          staffAuthenticationFreshnessMs
        ) {
          throw new AuthenticationFreshnessRequiredError();
        }
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [schoolConfigurationWorkspaceLockKey(input.session.workspaceId)],
        );
        const stateResult = await client.query<{
          draft_version: string;
          active_release_id: string | null;
          next_release_number: string;
          candidate_fingerprint: string;
        }>(
          `select state.draft_version, state.active_release_id,
                  state.next_release_number, draft.candidate_fingerprint
             from school_configuration.configuration_states state
             join school_configuration.draft_candidates draft using (workspace_id)
            where state.workspace_id = $1 for update of state`,
          [input.session.workspaceId],
        );
        const state = stateResult.rows[0];
        if (!state) throw new DraftVersionConflictError(0);
        if (state.active_release_id !== input.expectedActiveReleaseId) {
          throw new ActiveReleaseConflictError(state.active_release_id);
        }
        if (Number(state.draft_version) !== input.expectedDraftVersion) {
          throw new DraftVersionConflictError(Number(state.draft_version));
        }
        if (state.candidate_fingerprint !== input.candidateFingerprint) {
          throw new CandidateFingerprintConflictError(
            state.candidate_fingerprint,
          );
        }
        const releaseNumber = Number(state.next_release_number);
        await client.query(
          `update school_configuration.authored_revisions revision
              set lifecycle = 'frozen'
             from school_configuration.draft_components component
            where component.workspace_id = $1
              and revision.workspace_id = component.workspace_id
              and revision.resource_id = component.resource_id
              and revision.revision_number = component.revision_number
              and revision.lifecycle = 'working'`,
          [input.session.workspaceId],
        );
        await client.query(
          `insert into school_configuration.configuration_releases
             (release_id, workspace_id, release_number, candidate_fingerprint,
              candidate_fingerprint_algorithm, change_description,
              published_by, published_at)
           values ($1, $2, $3, $4, 'school-configuration-candidate/v1', $5, $6, $7)`,
          [
            input.releaseId,
            input.session.workspaceId,
            releaseNumber,
            input.candidateFingerprint,
            input.changeDescription,
            input.session.staffIdentityId,
            input.publishedAt,
          ],
        );
        for (const resource of input.resources) {
          await client.query(
            `insert into school_configuration.release_components
               (release_id, workspace_id, resource_id, revision_number, slot, position)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              input.releaseId,
              input.session.workspaceId,
              resource.resourceId,
              resource.revisionNumber,
              resource.slot,
              resource.position,
            ],
          );
        }
        await client.query(
          `insert into school_configuration.release_assemblies
             (release_id, workspace_id, candidate, recorded_at)
           values ($1, $2, $3, $4)`,
          [
            input.releaseId,
            input.session.workspaceId,
            input.candidate,
            input.publishedAt,
          ],
        );
        await client.query(
          `insert into school_configuration.release_packages
             (release_id, workspace_id, package_format,
              minimum_client_contract_version, candidate_fingerprint,
              package_digest, bucket, object_key, media_type,
              canonical_byte_length, operation_id, created_at)
           values ($1, $2, 'school-configuration-package/v1', 1, $3, $4,
                   'school-configuration-releases', $5, 'application/json',
                   $6, $7, $8)`,
          [
            input.releaseId,
            input.session.workspaceId,
            input.candidateFingerprint,
            input.packageDigest,
            input.packageObjectKey,
            input.packageByteLength,
            input.operationId,
            input.publishedAt,
          ],
        );
        const result: PublishSchoolConfigurationReleaseResult = {
          operationId: input.operationId,
          releaseId: input.releaseId,
          releaseNumber,
          candidateFingerprint: input.candidateFingerprint,
          activeReleaseId: input.releaseId,
          draftVersion: input.expectedDraftVersion + 1,
          package: {
            format: 'school-configuration-package/v1',
            digest: input.packageDigest,
            byteLength: input.packageByteLength,
          },
          replayed: false,
        };
        await client.query(
          `update school_configuration.configuration_states
              set active_release_id = $2, draft_version = $3,
                  next_release_number = $4
            where workspace_id = $1`,
          [
            input.session.workspaceId,
            input.releaseId,
            result.draftVersion,
            releaseNumber + 1,
          ],
        );
        await client.query(
          `insert into infrastructure.operation_receipts
             (workspace_id, operation_id, command_name, result,
              request_fingerprint, recorded_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, 'publishSchoolConfigurationRelease', $3, $4, $5,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            input.session.workspaceId,
            input.operationId,
            result,
            input.requestFingerprint,
            input.publishedAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, details, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'school_configuration_release.published',
                   'staff', $4, $5, $6, 'school', 'audit_evidence',
                   'workspace_audit_evidence')`,
          [
            input.auditId,
            input.session.workspaceId,
            input.operationId,
            input.session.staffIdentityId,
            input.publishedAt,
            {
              releaseId: input.releaseId,
              candidateFingerprint: input.candidateFingerprint,
              packageDigest: input.packageDigest,
            },
          ],
        );
        await client.query(
          `insert into infrastructure.outbox
             (outbox_id, workspace_id, operation_id, topic, payload, status,
              recorded_at, record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'school_configuration_release.published', $4,
                   'pending', $5, 'school', 'operational_evidence',
                   'transactional_outbox')`,
          [
            input.outboxId,
            input.session.workspaceId,
            input.operationId,
            {
              releaseId: input.releaseId,
              releaseNumber,
              packageDigest: input.packageDigest,
            },
            input.publishedAt,
          ],
        );
        await client.query(
          `update school_configuration.publication_attempts
              set status = 'succeeded', result = $3, updated_at = $4
            where workspace_id = $1 and operation_id = $2`,
          [
            input.session.workspaceId,
            input.operationId,
            result,
            input.publishedAt,
          ],
        );
        return result;
      });
    },
  };
}

export function sha256SessionHandle(handle: string): string {
  return createHash('sha256').update(handle).digest('hex');
}
