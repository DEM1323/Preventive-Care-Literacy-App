import type { Pool } from 'pg';
import type { InvitationDeliveryDependencies } from '../../../modules/invitation-delivery/index.ts';

export function createPostgresInvitationDeliveryPorts(
  pool: Pool,
): Pick<InvitationDeliveryDependencies, 'outbox' | 'deliveries'> {
  return {
    outbox: {
      async pending() {
        const result = await pool.query<{ outbox_id: string }>(
          'select * from infrastructure.pending_invitation_outbox()',
        );
        return result.rows.map((row) => ({ outboxId: row.outbox_id }));
      },
    },
    deliveries: {
      async claim(outboxId, now) {
        const result = await pool.query<{
          outcome: 'deliver' | 'suppressed';
          invitation_id: string | null;
          generation: number | null;
          purpose: 'join_class' | null;
          key_id: string | null;
          ciphertext: string | null;
          provider_idempotency_key: string | null;
        }>('select * from infrastructure.claim_invitation_delivery($1, $2)', [
          outboxId,
          now,
        ]);
        const row = result.rows[0];
        if (!row || row.outcome === 'suppressed')
          return { outcome: 'suppressed' };
        if (
          !row.invitation_id ||
          !row.generation ||
          !row.purpose ||
          !row.key_id ||
          !row.ciphertext ||
          !row.provider_idempotency_key
        ) {
          throw new Error('Invitation delivery claim is incomplete');
        }
        return {
          outcome: 'deliver',
          outboxId,
          invitationId: row.invitation_id,
          generation: row.generation,
          purpose: row.purpose,
          keyId: row.key_id,
          ciphertext: row.ciphertext,
          providerIdempotencyKey: row.provider_idempotency_key,
        };
      },
      async complete(input) {
        await pool.query(
          'select infrastructure.complete_invitation_delivery($1, $2, $3, $4, $5)',
          [
            input.outboxId,
            input.invitationId,
            input.generation,
            input.providerMessageId,
            input.deliveredAt,
          ],
        );
      },
      async suppress(input) {
        await pool.query(
          'select infrastructure.suppress_invitation_delivery($1, $2, $3)',
          [input.outboxId, input.invitationId, input.generation],
        );
      },
    },
  };
}
