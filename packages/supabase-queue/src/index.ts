import type { Pool } from 'pg';
import type { InvitationQueue } from '../../../modules/invitation-delivery/index.ts';

export function createSupabaseInvitationQueue(pool: Pool): InvitationQueue {
  return {
    async send(payload) {
      await pool.query(
        'select infrastructure.enqueue_invitation_delivery($1)',
        [payload.outboxId],
      );
    },
    async receive() {
      const result = await pool.query<{
        message_id: string;
        outbox_id: string;
        attempt: number;
      }>('select * from infrastructure.read_invitation_delivery()');
      const row = result.rows[0];
      return row
        ? {
            messageId: row.message_id,
            outboxId: row.outbox_id,
            attempt: row.attempt,
          }
        : undefined;
    },
    async complete(messageId) {
      await pool.query(
        'select infrastructure.complete_invitation_delivery_message($1)',
        [messageId],
      );
    },
    async retry(messageId, delaySeconds) {
      await pool.query(
        'select infrastructure.retry_invitation_delivery_message($1, $2)',
        [messageId, delaySeconds],
      );
    },
  };
}

export function createSupabaseSignInQueue(pool: Pool): InvitationQueue {
  return {
    async send(payload) {
      await pool.query('select infrastructure.enqueue_sign_in_delivery($1)', [
        payload.outboxId,
      ]);
    },
    async receive() {
      const result = await pool.query<{
        message_id: string;
        outbox_id: string;
        attempt: number;
      }>('select * from infrastructure.read_sign_in_delivery()');
      const row = result.rows[0];
      return row
        ? {
            messageId: row.message_id,
            outboxId: row.outbox_id,
            attempt: row.attempt,
          }
        : undefined;
    },
    async complete(messageId) {
      await pool.query(
        'select infrastructure.complete_sign_in_delivery_message($1)',
        [messageId],
      );
    },
    async retry(messageId, delaySeconds) {
      await pool.query(
        'select infrastructure.retry_sign_in_delivery_message($1, $2)',
        [messageId, delaySeconds],
      );
    },
  };
}
