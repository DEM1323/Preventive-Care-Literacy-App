import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../apps/server/src/app.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';

const digest = 'ab'.repeat(32);
const otherDigest = 'cd'.repeat(32);
const commit = 'beda69fca3f7954a0200a3209cb44aac7ade4a72';
const campaignId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0053';
const releaseId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0153';
const identitySetId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0253';
const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0353';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0453';
const now = new Date('2026-08-28T16:00:00.000Z');
const origin = 'http://127.0.0.1';
const operatorToken = 'release-candidate-operator-token-'.padEnd(40, 'x');
const operatorHeaders = {
  authorization: `Bearer ${operatorToken}`,
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;

function pinBody(artifactDigest = digest) {
  return {
    artifactDigest,
    environment: 'staging',
    environmentHost: 'staging.up.railway.app',
    environmentIdentity: 'railway-staging-public',
    schemaMigrations: [
      '001_audited_spine.sql',
      '034_release_candidate_evidence.sql',
    ],
    schoolConfigurationReleaseId: releaseId,
    syntheticIdentitySetId: identitySetId,
    commit,
  };
}

function startBody(artifactDigest = digest) {
  return {
    operationId: crypto.randomUUID(),
    campaignId,
    pin: pinBody(artifactDigest),
    syntheticIdentifiers: {
      workspaceId,
      staffIdentityId,
      classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf0553',
      studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf0653',
      invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf0753',
    },
  };
}

async function operatorFetch(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...operatorHeaders, ...init?.headers },
  });
}

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    operatorCredentials: {
      token: operatorToken,
      actorId: 'release-candidate-operator',
    },
    staffAuth: createFakeStaffAuth().provider,
    publicOrigin: origin,
    wrappingKeys: {
      wrappingKeys: { test: Buffer.alloc(32, 13) },
      activeWrappingKeyId: 'test',
      idempotencyKey: Buffer.alloc(32, 19),
    },
    invitationSecrets: {
      hmacKey: Buffer.alloc(32, 7),
      encryptionKeys: { test: Buffer.alloc(32, 9) },
      activeEncryptionKeyId: 'test',
    },
    artifactDigest: digest,
    clock: { now: () => now },
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  baseUrl =
    typeof address === 'string' ? address : `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    server.server.closeIdleConnections?.();
    server.server.closeAllConnections?.();
    await server.close();
  }
  await postgres?.stop();
});

test('acceptance campaign starts pending and never silently passes human evidence', async () => {
  const denied = await fetch(
    `${baseUrl}/api/v1/operator/acceptance-campaigns/current`,
  );
  expect(denied.status).toBe(401);

  const started = await operatorFetch('/api/v1/operator/acceptance-campaigns', {
    method: 'POST',
    body: JSON.stringify(startBody()),
  });
  expect(started.status).toBe(200);
  const campaign = (await started.json()) as {
    pin: { artifactDigest: string };
    schoolNurseAcceptance: { status: string };
    decision: { decision: string; reasons: string[] };
    journeys: Record<string, { outcome: string; source: string }>;
    matrix: Record<string, { source: string }>;
  };
  expect(campaign.pin.artifactDigest).toBe(digest);
  expect(campaign.schoolNurseAcceptance.status).toBe('missing');
  expect(campaign.decision.decision).toBe('pending');
  expect(campaign.decision.reasons).toContain(
    'school_nurse_acceptance_missing',
  );
  expect(campaign.journeys['success.clinical_reveal']?.source).toBe(
    'school_nurse_pending',
  );
  expect(campaign.matrix.safari_desktop?.source).toBe('human_browser_pending');
});

test('exact digest pin rejects mixed-candidate evidence and replays identical checks', async () => {
  const mixed = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/checks',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        kind: 'journey',
        checkId: 'success.staff_auth',
        outcome: 'pass',
        source: 'automated_synthetic',
        actorType: 'automation',
        pin: pinBody(otherDigest),
      }),
    },
  );
  expect(mixed.status).toBe(409);

  const operationId = crypto.randomUUID();
  const body = {
    operationId,
    kind: 'journey',
    checkId: 'success.staff_auth',
    outcome: 'pass',
    source: 'automated_synthetic',
    actorType: 'automation',
  };
  const first = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/checks',
    { method: 'POST', body: JSON.stringify(body) },
  );
  expect(first.status).toBe(200);
  const replayed = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/checks',
    { method: 'POST', body: JSON.stringify(body) },
  );
  expect(replayed.status).toBe(200);

  const conflict = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/checks',
    {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        operationId: crypto.randomUUID(),
        outcome: 'fail',
        nonWaivableCategory: 'false_success',
      }),
    },
  );
  expect(conflict.status).toBe(409);
});

test('non-waivable failure is no-go and cannot be waived; export stays non-sensitive', async () => {
  const failed = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/checks',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        kind: 'journey',
        checkId: 'denial.authorization',
        outcome: 'fail',
        source: 'automated_synthetic',
        actorType: 'automation',
        nonWaivableCategory: 'authorization_bypass',
      }),
    },
  );
  expect(failed.status).toBe(200);
  expect(await failed.json()).toMatchObject({
    decision: {
      decision: 'no-go',
      reasons: ['authorization_bypass'],
    },
  });

  const waived = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/exceptions',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        checkKind: 'journey',
        checkId: 'denial.authorization',
        requirement: 'Authorization denial',
        evidence: 'Should not waive',
        impact: 'none',
        mitigation: 'none',
        owner: 'technical_operator',
        expiry: '2026-09-30',
        reasonOutsideNonWaivable: 'not actually outside',
      }),
    },
  );
  expect(waived.status).toBe(409);

  const nurse = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/school-nurse-acceptance',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        staffIdentityId,
      }),
    },
  );
  expect(nurse.status).toBe(200);

  const evidence = await operatorFetch(
    '/api/v1/operator/acceptance-campaigns/current/evidence',
  );
  expect(evidence.status).toBe(200);
  const bundle = await evidence.json();
  expect(JSON.stringify(bundle)).not.toContain('@');
  expect(JSON.stringify(bundle)).not.toContain('answers');
  expect(bundle).toMatchObject({
    schemaVersion: 1,
    decision: { decision: 'no-go' },
    schoolNurseAcceptance: { status: 'recorded' },
  });
});
