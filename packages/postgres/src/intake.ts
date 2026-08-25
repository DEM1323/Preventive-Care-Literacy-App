import type { Pool, PoolClient } from 'pg';
import {
  IntakeAlreadyAcceptedError,
  IntakeOperationReusedError,
  IntakeRevisionConflictError,
  IntakeUnavailableError,
  type ExactResourceRevision,
  type IntakeStore,
  type SealedRecord,
  type StoredIntakeDraft,
  type StoredIntakeRecordVersion,
  type SubmitIntakeRecordVersionResult,
} from '../../../modules/intake/index.ts';
import { schoolConfigurationWorkspaceLockKey } from './workspace-locks.ts';

async function setStudentScope(
  client: PoolClient,
  input: { workspaceId: string; studentId: string },
): Promise<void> {
  await client.query("select set_config('app.workspace_id', $1, true)", [
    input.workspaceId,
  ]);
  await client.query("select set_config('app.student_id', $1, true)", [
    input.studentId,
  ]);
}

async function transaction<Result>(
  pool: Pool,
  run: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function sealedFrom(row: {
  wrapping_key_id: string;
  wrapped_data_key: string;
  ciphertext: string;
}): SealedRecord {
  return {
    wrappingKeyId: row.wrapping_key_id,
    wrappedDataKey: row.wrapped_data_key,
    ciphertext: row.ciphertext,
  };
}

async function lockSchoolConfigurationWorkspace(
  client: PoolClient,
  workspaceId: string,
): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    schoolConfigurationWorkspaceLockKey(workspaceId),
  ]);
}

async function readActiveIntakeRelease(
  client: PoolClient,
  workspaceId: string,
) {
  const release = await client.query<{
    release_id: string;
    form_resource_id: string;
    form_revision_number: number;
    form_payload: Record<string, unknown>;
    attestation_resource_id: string;
    attestation_revision_number: number;
    attestation_payload: Record<string, unknown>;
  }>(
    `select state.active_release_id as release_id,
            form_component.resource_id as form_resource_id,
            form_component.revision_number as form_revision_number,
            form_revision.payload as form_payload,
            attestation_component.resource_id as attestation_resource_id,
            attestation_component.revision_number as attestation_revision_number,
            attestation_revision.payload as attestation_payload
       from school_configuration.configuration_states state
       join school_configuration.release_components form_component
         on form_component.release_id = state.active_release_id
        and form_component.workspace_id = state.workspace_id
        and form_component.slot = 'candidate.release.intakeForm'
       join school_configuration.authored_revisions form_revision
         on form_revision.workspace_id = form_component.workspace_id
        and form_revision.resource_id = form_component.resource_id
        and form_revision.revision_number = form_component.revision_number
       join school_configuration.release_components attestation_component
         on attestation_component.release_id = state.active_release_id
        and attestation_component.workspace_id = state.workspace_id
        and attestation_component.slot = 'candidate.release.submissionAttestation'
       join school_configuration.authored_revisions attestation_revision
         on attestation_revision.workspace_id = attestation_component.workspace_id
        and attestation_revision.resource_id = attestation_component.resource_id
        and attestation_revision.revision_number = attestation_component.revision_number
      where state.workspace_id = $1 and state.active_release_id is not null`,
    [workspaceId],
  );
  const active = release.rows[0];
  if (!active) return undefined;
  return {
    schoolConfigurationReleaseId: active.release_id,
    intakeForm: {
      resourceId: active.form_resource_id,
      revisionNumber: active.form_revision_number,
      payload: active.form_payload,
    },
    submissionAttestation: {
      resourceId: active.attestation_resource_id,
      revisionNumber: active.attestation_revision_number,
      payload: active.attestation_payload,
    },
  };
}

function sameRevision(
  expected: ExactResourceRevision,
  actual: ExactResourceRevision,
): boolean {
  return (
    expected.resourceId === actual.resourceId &&
    expected.revisionNumber === actual.revisionNumber
  );
}

function requireExpectedRelease(
  release: Awaited<ReturnType<typeof readActiveIntakeRelease>> | undefined,
  expected: {
    schoolConfigurationReleaseId: string;
    intakeForm: ExactResourceRevision;
    submissionAttestation?: ExactResourceRevision;
  },
) {
  if (!release) throw new IntakeUnavailableError();
  if (
    release.schoolConfigurationReleaseId !==
      expected.schoolConfigurationReleaseId ||
    !sameRevision(expected.intakeForm, {
      resourceId: release.intakeForm.resourceId,
      revisionNumber: release.intakeForm.revisionNumber,
    }) ||
    (expected.submissionAttestation &&
      !sameRevision(expected.submissionAttestation, {
        resourceId: release.submissionAttestation.resourceId,
        revisionNumber: release.submissionAttestation.revisionNumber,
      }))
  ) {
    throw new IntakeRevisionConflictError();
  }
  return release;
}

export function createPostgresIntakeStore(options: {
  pool: Pool;
}): IntakeStore {
  return {
    async readWorkspaceIntake(input) {
      return transaction(options.pool, async (client) => {
        await setStudentScope(client, input);
        const release = await readActiveIntakeRelease(
          client,
          input.workspaceId,
        );
        const draft = await client.query<{
          locale: StoredIntakeDraft['locale'];
          updated_at: Date;
          wrapping_key_id: string;
          wrapped_data_key: string;
          ciphertext: string;
        }>(
          `select locale, updated_at, wrapping_key_id, wrapped_data_key, ciphertext
             from intake.intake_drafts
            where student_id = $1 and workspace_id = $2`,
          [input.studentId, input.workspaceId],
        );
        const current = await client.query<{
          intake_record_version_id: string;
          accepted_at: Date;
          school_configuration_release_id: string;
          intake_form_resource_id: string;
          intake_form_revision_number: number;
          submission_attestation_resource_id: string;
          submission_attestation_revision_number: number;
          locale: StoredIntakeRecordVersion['locale'];
        }>(
          `select intake_record_version_id, accepted_at, school_configuration_release_id,
                  intake_form_resource_id, intake_form_revision_number,
                  submission_attestation_resource_id,
                  submission_attestation_revision_number, locale
             from intake.intake_record_versions
            where student_id = $1 and workspace_id = $2 and superseded_at is null`,
          [input.studentId, input.workspaceId],
        );
        const draftRow = draft.rows[0];
        const currentRow = current.rows[0];
        return {
          release,
          draft: draftRow
            ? {
                locale: draftRow.locale,
                updatedAt: draftRow.updated_at,
                sealed: sealedFrom(draftRow),
              }
            : undefined,
          currentVersion: currentRow
            ? {
                intakeRecordVersionId: currentRow.intake_record_version_id,
                acceptedAt: currentRow.accepted_at,
                schoolConfigurationReleaseId:
                  currentRow.school_configuration_release_id,
                intakeForm: {
                  resourceId: currentRow.intake_form_resource_id,
                  revisionNumber: currentRow.intake_form_revision_number,
                },
                submissionAttestation: {
                  resourceId: currentRow.submission_attestation_resource_id,
                  revisionNumber:
                    currentRow.submission_attestation_revision_number,
                },
                locale: currentRow.locale,
              }
            : undefined,
        };
      });
    },

    async saveDraft(input) {
      await transaction(options.pool, async (client) => {
        await setStudentScope(client, input);
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`intake:${input.studentId}`],
        );
        await lockSchoolConfigurationWorkspace(client, input.workspaceId);
        const release = requireExpectedRelease(
          await readActiveIntakeRelease(client, input.workspaceId),
          {
            schoolConfigurationReleaseId:
              input.expectedSchoolConfigurationReleaseId,
            intakeForm: input.expectedIntakeForm,
          },
        );
        const accepted = await client.query(
          `select 1 from intake.intake_record_versions
            where student_id = $1 and workspace_id = $2 and superseded_at is null`,
          [input.studentId, input.workspaceId],
        );
        if (accepted.rowCount === 1) throw new IntakeAlreadyAcceptedError();
        await client.query(
          `insert into intake.intake_drafts
             (student_id, workspace_id, school_configuration_release_id,
              intake_form_resource_id, intake_form_revision_number, locale,
              wrapping_key_id, wrapped_data_key, ciphertext, updated_at,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   'school', 'student_record', 'intake_draft')
           on conflict (student_id, workspace_id) do update
             set school_configuration_release_id = excluded.school_configuration_release_id,
                 intake_form_resource_id = excluded.intake_form_resource_id,
                 intake_form_revision_number = excluded.intake_form_revision_number,
                 locale = excluded.locale,
                 wrapping_key_id = excluded.wrapping_key_id,
                 wrapped_data_key = excluded.wrapped_data_key,
                 ciphertext = excluded.ciphertext,
                 updated_at = excluded.updated_at`,
          [
            input.studentId,
            input.workspaceId,
            release.schoolConfigurationReleaseId,
            release.intakeForm.resourceId,
            release.intakeForm.revisionNumber,
            input.locale,
            input.sealed.wrappingKeyId,
            input.sealed.wrappedDataKey,
            input.sealed.ciphertext,
            input.updatedAt,
          ],
        );
      });
    },

    async submit(input) {
      return transaction(options.pool, async (client) => {
        await setStudentScope(client, input);
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`intake:${input.studentId}`],
        );
        const receipt = await client.query<{
          request_binding: string;
          result: SubmitIntakeRecordVersionResult;
        }>(
          `select request_binding, result
             from intake.intake_operation_receipts
            where workspace_id = $1 and student_id = $2 and operation_id = $3`,
          [input.workspaceId, input.studentId, input.operationId],
        );
        if (receipt.rows[0]) {
          if (receipt.rows[0].request_binding !== input.requestBinding) {
            throw new IntakeOperationReusedError();
          }
          return {
            outcome: 'replayed' as const,
            result: receipt.rows[0].result,
          };
        }
        await lockSchoolConfigurationWorkspace(client, input.workspaceId);
        const release = requireExpectedRelease(
          await readActiveIntakeRelease(client, input.workspaceId),
          {
            schoolConfigurationReleaseId:
              input.expectedSchoolConfigurationReleaseId,
            intakeForm: input.expectedIntakeForm,
            submissionAttestation: input.expectedSubmissionAttestation,
          },
        );
        const current = await client.query(
          `select 1 from intake.intake_record_versions
            where student_id = $1 and workspace_id = $2 and superseded_at is null`,
          [input.studentId, input.workspaceId],
        );
        if (current.rowCount === 1) throw new IntakeAlreadyAcceptedError();

        const result: SubmitIntakeRecordVersionResult = {
          operationId: input.operationId,
          intakeRecordVersionId: input.proposedVersionId,
          acceptedAt: input.acceptedAt.toISOString(),
          learningUnlocked: true,
          replayed: true,
        };
        await client.query(
          `insert into intake.intake_record_versions
             (intake_record_version_id, student_id, workspace_id, version_number,
              school_configuration_release_id, intake_form_resource_id,
              intake_form_revision_number, submission_attestation_resource_id,
              submission_attestation_revision_number, locale, wrapping_key_id,
              wrapped_data_key, ciphertext, accepted_at, superseded_at,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, null,
                   'school', 'student_record', 'intake_record_version')`,
          [
            input.proposedVersionId,
            input.studentId,
            input.workspaceId,
            release.schoolConfigurationReleaseId,
            release.intakeForm.resourceId,
            release.intakeForm.revisionNumber,
            release.submissionAttestation.resourceId,
            release.submissionAttestation.revisionNumber,
            input.locale,
            input.sealed.wrappingKeyId,
            input.sealed.wrappedDataKey,
            input.sealed.ciphertext,
            input.acceptedAt,
          ],
        );
        await client.query(
          `delete from intake.intake_drafts
            where student_id = $1 and workspace_id = $2`,
          [input.studentId, input.workspaceId],
        );
        await client.query(
          `insert into intake.intake_operation_receipts
             (workspace_id, student_id, operation_id, command_name, result,
              request_binding, recorded_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'submitIntakeRecordVersion', $4, $5, $6,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            input.workspaceId,
            input.studentId,
            input.operationId,
            { ...result, replayed: true },
            input.requestBinding,
            input.acceptedAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, details, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'intake_record_version.accepted', 'student', $4,
                   $5, $6, 'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            input.auditId,
            input.workspaceId,
            input.operationId,
            input.studentId,
            input.acceptedAt,
            {
              intakeRecordVersionId: input.proposedVersionId,
              schoolConfigurationReleaseId:
                release.schoolConfigurationReleaseId,
            },
          ],
        );
        await client.query(
          `insert into infrastructure.outbox
             (outbox_id, workspace_id, operation_id, topic, payload, status,
              recorded_at, record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'intake_record_version.accepted', $4, 'pending',
                   $5, 'school', 'operational_evidence', 'transactional_outbox')`,
          [
            input.outboxId,
            input.workspaceId,
            input.operationId,
            {
              studentId: input.studentId,
              intakeRecordVersionId: input.proposedVersionId,
              schoolConfigurationReleaseId:
                release.schoolConfigurationReleaseId,
            },
            input.acceptedAt,
          ],
        );
        return {
          outcome: 'accepted' as const,
          intakeRecordVersionId: input.proposedVersionId,
          acceptedAt: input.acceptedAt,
        };
      });
    },
  };
}
