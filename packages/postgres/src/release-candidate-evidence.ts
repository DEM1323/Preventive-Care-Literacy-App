import type { Pool } from 'pg';
import {
  applyCampaignCheck,
  applyLowerRiskException,
  applySchoolNurseAcceptance,
  ReleaseCandidateEvidenceError,
  type CampaignSnapshot,
  type ReleaseCandidateEvidenceStore,
} from '../../../modules/release-candidate-evidence/index.ts';

function parseJson<T>(value: T | string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function pinFingerprint(campaign: CampaignSnapshot): string {
  return [
    campaign.campaignId,
    campaign.pin.artifactDigest,
    campaign.pin.environmentHost,
    campaign.pin.environmentIdentity,
    campaign.pin.schoolConfigurationReleaseId,
    campaign.pin.syntheticIdentitySetId,
    campaign.pin.commit,
    campaign.pin.schemaMigrations.join(','),
  ].join(':');
}

export function createPostgresReleaseCandidateEvidenceStore(options: {
  pool: Pool;
}): ReleaseCandidateEvidenceStore {
  async function readCampaign() {
    const listed = await options.pool.query<{
      read_acceptance_campaign: CampaignSnapshot | string | null;
    }>('select infrastructure.read_acceptance_campaign()');
    return parseJson(listed.rows[0]?.read_acceptance_campaign ?? undefined);
  }

  return {
    readCampaign,

    async startCampaign(request) {
      const existing = await readCampaign();
      if (existing) {
        const samePin =
          pinFingerprint(existing) === pinFingerprint(request.campaign);
        if (samePin) {
          const claimed = await writeCampaign(options.pool, {
            operationId: request.operationId,
            command: 'startCampaign',
            fingerprint: pinFingerprint(request.campaign),
            actorId: request.actorId,
            snapshot: existing,
            replace: false,
            occurredAt: request.occurredAt,
          });
          if (claimed.outcome === 'operation_reused') {
            return { outcome: 'operation_reused' };
          }
          return {
            outcome: claimed.outcome,
            campaign: parseJson(claimed.result) ?? existing,
          };
        }
        if (!request.replaceExisting) {
          return { outcome: 'pin_mismatch' };
        }
      }
      const claimed = await writeCampaign(options.pool, {
        operationId: request.operationId,
        command: 'startCampaign',
        fingerprint: pinFingerprint(request.campaign),
        actorId: request.actorId,
        snapshot: request.campaign,
        replace: request.replaceExisting,
        occurredAt: request.occurredAt,
      });
      if (claimed.outcome === 'operation_reused') {
        return { outcome: 'operation_reused' };
      }
      const campaign = parseJson(claimed.result);
      if (!campaign) return { outcome: 'operation_reused' };
      return { outcome: claimed.outcome, campaign };
    },

    async recordCheck(request) {
      const existing = await readCampaign();
      if (!existing) return { outcome: 'not_found' };
      try {
        const next = applyCampaignCheck(existing, request.input);
        const claimed = await writeCampaign(options.pool, {
          operationId: request.operationId,
          command: 'recordCheck',
          fingerprint: [
            request.input.kind,
            request.input.checkId,
            request.input.outcome,
            request.input.source,
          ].join(':'),
          actorId: request.actorId,
          snapshot: next,
          replace: false,
          occurredAt: request.occurredAt,
        });
        if (claimed.outcome === 'operation_reused') {
          return { outcome: 'operation_reused' };
        }
        const campaign = parseJson(claimed.result);
        if (!campaign) return { outcome: 'operation_reused' };
        return { outcome: claimed.outcome, campaign };
      } catch (error) {
        if (
          error instanceof ReleaseCandidateEvidenceError &&
          error.code === 'PIN_MISMATCH'
        ) {
          return { outcome: 'pin_mismatch' };
        }
        if (
          error instanceof ReleaseCandidateEvidenceError &&
          error.code === 'CHECK_CONFLICT'
        ) {
          return { outcome: 'check_conflict' };
        }
        throw error;
      }
    },

    async recordException(request) {
      const existing = await readCampaign();
      if (!existing) return { outcome: 'not_found' };
      try {
        const next = applyLowerRiskException(existing, request.exception);
        const claimed = await writeCampaign(options.pool, {
          operationId: request.operationId,
          command: 'recordException',
          fingerprint: [
            request.exception.checkKind,
            request.exception.checkId,
            request.exception.requirement,
            request.exception.expiry,
          ].join(':'),
          actorId: request.actorId,
          snapshot: next,
          replace: false,
          occurredAt: request.occurredAt,
        });
        if (claimed.outcome === 'operation_reused') {
          return { outcome: 'operation_reused' };
        }
        const campaign = parseJson(claimed.result);
        if (!campaign) return { outcome: 'operation_reused' };
        return { outcome: claimed.outcome, campaign };
      } catch (error) {
        if (
          error instanceof ReleaseCandidateEvidenceError &&
          error.code === 'INCOMPLETE_EXCEPTION'
        ) {
          return { outcome: 'incomplete' };
        }
        if (
          error instanceof ReleaseCandidateEvidenceError &&
          error.code === 'NON_WAIVABLE_EXCEPTION'
        ) {
          return { outcome: 'non_waivable' };
        }
        throw error;
      }
    },

    async recordSchoolNurseAcceptance(request) {
      const existing = await readCampaign();
      if (!existing) return { outcome: 'not_found' };
      const next = applySchoolNurseAcceptance(existing, {
        recordedAt: request.occurredAt.toISOString(),
        actorId: request.staffIdentityId,
      });
      const claimed = await writeCampaign(options.pool, {
        operationId: request.operationId,
        command: 'recordSchoolNurseAcceptance',
        fingerprint: existing.campaignId,
        actorId: request.actorId,
        snapshot: next,
        replace: false,
        occurredAt: request.occurredAt,
      });
      if (claimed.outcome === 'operation_reused') {
        return { outcome: 'operation_reused' };
      }
      const campaign = parseJson(claimed.result);
      if (!campaign) return { outcome: 'operation_reused' };
      return { outcome: claimed.outcome, campaign };
    },
  };
}

async function writeCampaign(
  pool: Pool,
  request: {
    operationId: string;
    command: string;
    fingerprint: string;
    actorId: string;
    snapshot: CampaignSnapshot;
    replace: boolean;
    occurredAt: Date;
  },
): Promise<{
  outcome: 'applied' | 'replayed' | 'operation_reused';
  result?: CampaignSnapshot | string;
}> {
  const written = await pool.query<{
    write_acceptance_campaign: {
      outcome: 'applied' | 'replayed' | 'operation_reused';
      result?: CampaignSnapshot | string;
    };
  }>('select infrastructure.write_acceptance_campaign($1,$2,$3,$4,$5,$6,$7)', [
    request.operationId,
    request.command,
    request.fingerprint,
    request.actorId,
    JSON.stringify(request.snapshot),
    request.replace,
    request.occurredAt,
  ]);
  return (
    written.rows[0]?.write_acceptance_campaign ?? {
      outcome: 'operation_reused',
    }
  );
}
