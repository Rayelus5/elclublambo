import type { Kysely } from 'kysely';
import type { DB } from './db/schema';

/** Who did it: an admin account, or a system actor such as the container CLI (`{ id: null, label: 'cli' }`). */
export type AuditActor = { id: string | null; label: string; ip?: string };

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
};

/**
 * Appends to galaxy.admin_audit_log (append-only by trigger). Call it with the same transaction as the change it
 * records, so the change and its trace commit or roll back together. Never put secrets in before/after.
 */
export async function writeAudit(trx: Kysely<DB>, e: AuditEntry): Promise<void> {
  await trx
    .insertInto('galaxy.admin_audit_log')
    .values({
      actor_id: e.actor.id,
      actor_label: e.actor.label,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      before: e.before === undefined ? null : JSON.stringify(e.before),
      after: e.after === undefined ? null : JSON.stringify(e.after),
      reason: e.reason,
      ip: e.actor.ip && e.actor.ip !== 'unknown' ? e.actor.ip : null,
    })
    .execute();
}
