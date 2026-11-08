import type { AuditPage, AuditQuery, AuditRow } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';

// The audit log for admins (GDD §16.1; M6a): filtered by who, what, whom and dates, in pages, or exported to CSV. The
// log itself is append-only; this only reads it.

const PAGE = 50;
const CSV_MAX = 5000;

function filtered(db: Kysely<DB>, q: AuditQuery) {
  let query = db.selectFrom('galaxy.admin_audit_log');
  if (q.actor) query = query.where('actor_label', '=', q.actor);
  if (q.action) query = query.where('action', '=', q.action);
  if (q.target) query = query.where('target_id', '=', q.target);
  if (q.from) query = query.where('at', '>=', new Date(`${q.from}T00:00:00.000Z`));
  if (q.to) query = query.where('at', '<', new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000));
  return query;
}

type Row = { id: string; at: Date; actor_label: string; action: string; target_type: string | null; target_id: string | null; before: unknown; after: unknown; reason: string; ip: string | null };
const rowOf = (r: Row): AuditRow => ({
  id: String(r.id),
  at: new Date(r.at).toISOString(),
  actor: r.actor_label,
  action: r.action,
  targetType: r.target_type,
  targetId: r.target_id,
  before: r.before,
  after: r.after,
  reason: r.reason,
  ip: r.ip,
});

const COLUMNS = ['id', 'at', 'actor_label', 'action', 'target_type', 'target_id', 'before', 'after', 'reason', 'ip'] as const;

export async function auditPage(db: Kysely<DB>, q: AuditQuery): Promise<AuditPage> {
  const { n } = await filtered(db, q)
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  const rows = (await filtered(db, q).select(COLUMNS).orderBy('id', 'desc').limit(PAGE).offset((q.page - 1) * PAGE).execute()) as Row[];
  return { rows: rows.map(rowOf), page: q.page, pages: Math.max(1, Math.ceil(Number(n) / PAGE)) };
}

const cell = (v: unknown) => {
  const raw = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Formula injection (M6a review): a cell that starts like a formula is written as text.
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The filtered log as CSV (UTF-8 with a BOM, so spreadsheets read the accents), newest first, 5000 rows at most. */
export async function auditCsv(db: Kysely<DB>, q: AuditQuery): Promise<string> {
  const rows = (await filtered(db, q).select(COLUMNS).orderBy('id', 'desc').limit(CSV_MAX).execute()) as Row[];
  const lines = ['fecha,quien,accion,tipo,objetivo,motivo,ip,antes,despues'];
  for (const r of rows.map(rowOf)) lines.push([r.at, r.actor, r.action, r.targetType, r.targetId, r.reason, r.ip, r.before, r.after].map(cell).join(','));
  return `\uFEFF${lines.join('\n')}\n`;
}
