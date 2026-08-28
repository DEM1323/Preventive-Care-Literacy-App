import { readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { format } from 'prettier';
import { buildApp } from '../apps/server/src/app.ts';

const openapiPath = new URL(
  '../packages/http-contract/openapi.json',
  import.meta.url,
);
const clientSchemaPath = new URL(
  '../packages/api-client/src/schema.ts',
  import.meta.url,
);

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortDeep(child)]),
    );
  }
  return value;
}

async function renderContracts() {
  const app = await buildApp(
    {
      createSchoolWorkspace: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      provisionStaffIdentity: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      recoverStaffIdentity: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      disableStaffIdentity: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      replaceStaffPermissions: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      startStaffSignIn: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      completeStaffSignIn: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      resolveStaffSession: async () => undefined,
      requireAdministrativeSession: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      stepUpStaffSession: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      endStaffSession: async () => ({ outcome: 'ended' }),
      listStaffIdentities: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      openClinicalDirectory: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      requireFreshClinicalSession: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      createClassInvitation: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      createClass: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      previewClassInvitation: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      previewClassInvitationCsv: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      sendClassInvitation: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      sendClassInvitationCsv: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      resendClassInvitation: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      revokeClassInvitation: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      deactivateClassMembership: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      closeClass: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      replaceStudentVerifiedEmail: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      disableStudentAccess: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      enableStudentAccess: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      listClasses: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      redeemInvitation: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      requestStudentSignIn: async () => ({ outcome: 'accepted' as const }),
      completeStudentSignIn: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      saveStudentLanguage: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      resolveStudentSession: async () => undefined,
    },
    {
      publicOrigin: 'https://contract-generator.example',
      operatorAuthenticator: {
        authenticate: () => ({
          type: 'technical_operator',
          id: 'contract-generator',
        }),
        createSession: () => 'contract-generator-session',
      },
      listOperatorWorkspaces: async () => [],
      operatorRepair: {
        listRepairableWork: async () => [],
        repairWork: async () => {
          throw new Error('Contract generation does not execute commands');
        },
      },
      operationalReadiness: {
        readBackupConfiguration: async () => undefined,
        recordBackupConfiguration: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        readRestoreReadiness: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        recordRestoreRun: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        listAlerts: async () => [],
        emitAlert: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        acknowledgeAlert: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        activityIsStopped: async () => false,
        readIncident: async () => undefined,
        requestStop: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        revokeAccess: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        preserveEvidence: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordRepair: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordChecks: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        authorizeResume: async () => {
          throw new Error('Contract generation does not execute commands');
        },
      },
      releaseCandidateEvidence: {
        readCampaign: async () => undefined,
        startCampaign: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordCheck: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordException: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordSchoolNurseAcceptance: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        exportEvidence: async () => {
          throw new Error('Contract generation does not execute queries');
        },
      },
      schoolConfiguration: {
        readDraft: async () => undefined,
        stepUp: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        importDraft: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        editDraft: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        generateTranslations: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        publish: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        listReleases: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        readRelease: async () => {
          throw new Error('Contract generation does not execute queries');
        },
      },
      intake: {
        read: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        saveDraft: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        reopen: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        rebase: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        submit: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        revealCurrent: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        revealVersion: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        selectStudent: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        reportUnauthenticatedReveal: async () => {
          throw new Error('Contract generation does not execute commands');
        },
      },
      learningProgress: {
        read: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        acknowledge: async () => {
          throw new Error('Contract generation does not execute commands');
        },
      },
      recordsGovernance: {
        recordStudentDeparture: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        reverseStudentDeparture: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        openRecordLifecycleCase: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        decideRecordLifecycleCase: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordRecordLifecycleCaseOutcome: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        establishRecordHold: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        releaseRecordHold: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        listRecordsGovernance: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        resolveRecordAmendment: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        openRecordConflictReview: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        decideRecordConflictReview: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        authorizeRecordProduction: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        retrieveRecordProduction: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        repairRecordProductionCleanup: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        completeRecordDispositionNotice: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        completeRecordDispositionCopyOpportunity: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        scheduleRecordDisposition: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        cancelRecordDisposition: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        executeRecordDisposition: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        retryRecordDisposition: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        reconcilePurgeVerification: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        recordProviderVerification: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        verifyBackupExpiry: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        issueDestructionCertificate: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        readDestructionCertificate: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        beginPurgeRestoreGate: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        runPurgeRestoreGate: async () => {
          throw new Error('Contract generation does not execute commands');
        },
        listPurgeTombstones: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        readPurgeRestoreGate: async () => {
          throw new Error('Contract generation does not execute queries');
        },
        assertPurgeRestoreReady: async () => {
          throw new Error('Contract generation does not execute queries');
        },
      },
    },
  );
  const document = sortDeep(app.swagger());
  await app.close();

  const openapi = await format(JSON.stringify(document), { parser: 'json' });
  const clientSchema = await format(
    `${COMMENT_HEADER}${astToString(
      await openapiTS(document as Parameters<typeof openapiTS>[0], {
        alphabetize: true,
      }),
    )}`,
    { parser: 'typescript', singleQuote: true },
  );
  return { openapi, clientSchema };
}

const rendered = await renderContracts();
if (process.argv.includes('--check')) {
  const [committedOpenapi, committedClientSchema] = await Promise.all([
    readFile(openapiPath, 'utf8'),
    readFile(clientSchemaPath, 'utf8'),
  ]);
  if (
    committedOpenapi !== rendered.openapi ||
    committedClientSchema !== rendered.clientSchema
  ) {
    throw new Error(
      'Generated API contracts are stale. Run bun run generate:contracts.',
    );
  }
} else {
  await Promise.all([
    writeFile(openapiPath, rendered.openapi),
    writeFile(clientSchemaPath, rendered.clientSchema),
  ]);
}
