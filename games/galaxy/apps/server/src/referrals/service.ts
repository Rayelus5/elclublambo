import { randomBytes } from 'node:crypto';
import {
  type AccountConfig,
  type AdminReferralCode,
  type AdminReferralList,
  type AdminReferralOwner,
  type AdminReferralRow,
  type AdminReferralSummary,
  type ConfigValue,
  hasGifts,
  levelOf,
  type MailGifts,
  type MyReferrals,
  type ReferralFlag,
  type ReferralOverride,
  type ReferralRules,
  referralRules,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { AuditActor } from '../audit';
import { writeAudit } from '../audit';
import { isUniqueViolation } from '../auth/accounts';
import { rolesOf } from '../auth/sessions';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { sendSystemMail } from '../mail/system';
import type { Notices } from '../realtime/notices';

// Referrals (plan «referidos»; the owner). A code belongs to a veteran player; a new player signs up with it. The
// newcomer's gift goes to the mailbox at once, the owner's when the newcomer reaches the level, each paid once (the
// paid dates are the guards). A sign-up that looks like the same person — the owner's address, another newcomer's of
// the same code, too many from one address in a day, or a code or an owner past its cap — is created but held: no
// gift until an admin approves it; a rejected one never pays.

type Db = Kysely<DB>;
export type ReferralsConfig = ConfigValue<'referrals'>;
const DAY = 86_400_000;
const PAGE = 50;

const globalRules = (cfg: ReferralsConfig): ReferralRules => ({ ownerGifts: cfg.ownerGifts, newcomerGifts: cfg.newcomerGifts, activationLevel: cfg.activationLevel });

async function overrideOf(db: Db, owner: string): Promise<ReferralOverride | null> {
  const row = await db.selectFrom('galaxy.referral_rewards').selectAll().where('owner_id', '=', owner).executeTakeFirst();
  if (!row) return null;
  return { ownerGifts: (row.owner_gifts as MailGifts | null) ?? null, newcomerGifts: (row.newcomer_gifts as MailGifts | null) ?? null, activationLevel: row.activation_level };
}

/** The rules an owner's codes follow: their own where set, the global ones for the rest. */
export async function rulesFor(db: Db, owner: string, cfg: ReferralsConfig): Promise<ReferralRules> {
  return referralRules(globalRules(cfg), await overrideOf(db, owner));
}

const usernameOf = async (db: Db, id: string) => (await db.selectFrom('galaxy.accounts').select('username').where('id', '=', id).executeTakeFirstOrThrow()).username;

async function payNewcomer(trx: Db, r: { account_id: string; owner_id: string; code: string }, rules: ReferralRules, out?: Notices): Promise<void> {
  const [newcomer, owner] = await Promise.all([usernameOf(trx, r.account_id), usernameOf(trx, r.owner_id)]);
  if (hasGifts(rules.newcomerGifts)) {
    await sendSystemMail(trx, { id: r.account_id, username: newcomer }, { title: `Bienvenida de ${owner}`, body: `Has entrado con el código ${r.code} de ${owner}. Aquí tienes tu regalo de bienvenida`, gifts: rules.newcomerGifts }, out);
  }
  await trx.updateTable('galaxy.referrals').set({ newcomer_paid_at: sql<Date>`now()` }).where('account_id', '=', r.account_id).execute();
}

async function payOwner(trx: Db, r: { account_id: string; owner_id: string; code: string }, rules: ReferralRules, out?: Notices): Promise<void> {
  const [newcomer, owner] = await Promise.all([usernameOf(trx, r.account_id), usernameOf(trx, r.owner_id)]);
  if (hasGifts(rules.ownerGifts)) {
    await sendSystemMail(
      trx,
      { id: r.owner_id, username: owner },
      { title: `${newcomer} ya es de nivel ${rules.activationLevel}`, body: `${newcomer} entró con tu código ${r.code} y ya ha llegado al nivel ${rules.activationLevel}. Gracias por traerlo: aquí tienes tu premio`, gifts: rules.ownerGifts },
      out,
    );
  }
  await trx.updateTable('galaxy.referrals').set({ state: 'rewarded', owner_paid_at: sql<Date>`now()` }).where('account_id', '=', r.account_id).execute();
}

/**
 * A sign-up with a code, in the transaction that creates the account: the code must exist (else `referral_invalid`)
 * and be usable — on, not past its end, under its cap of uses (else `referral_unavailable`). Its row is locked so two
 * sign-ups never both take its last use.
 */
export async function signUpWithCode(
  trx: Db,
  cfg: ReferralsConfig,
  newcomer: { id: string; ip: string | null; userAgent: string | null },
  code: string,
  out?: Notices,
): Promise<void> {
  const row = await trx.selectFrom('galaxy.referral_codes').selectAll().where('code', '=', code).forUpdate().executeTakeFirst();
  if (!row) throw new HttpError(400, 'referral_invalid');
  const uses = Number((await trx.selectFrom('galaxy.referrals').select(sql<number>`count(*)::int`.as('n')).where('code_id', '=', row.id).executeTakeFirstOrThrow()).n);
  if (!row.enabled || (row.expires_at && new Date(row.expires_at) <= new Date()) || (row.max_uses !== null && uses >= row.max_uses)) throw new HttpError(409, 'referral_unavailable');

  const flags: ReferralFlag[] = [];
  const since = (days: number) => sql<Date>`now() - make_interval(days => ${days})`;
  if (newcomer.ip) {
    const ip = newcomer.ip;
    const [ownerIp, sibling, burst] = await Promise.all([
      trx.selectFrom('galaxy.account_ips').select('ip').where('account_id', '=', row.owner_id).where('ip', '=', ip).where('last_seen', '>', since(cfg.sharedIpDays)).executeTakeFirst(),
      trx.selectFrom('galaxy.referrals').select('account_id').where('code_id', '=', row.id).where('signup_ip', '=', ip).where('created_at', '>', since(cfg.sharedIpDays)).executeTakeFirst(),
      trx.selectFrom('galaxy.referrals').select(sql<number>`count(*)::int`.as('n')).where('signup_ip', '=', ip).where('created_at', '>', since(1)).executeTakeFirstOrThrow(),
    ]);
    if (ownerIp) flags.push('owner_ip');
    if (sibling) flags.push('sibling_ip');
    if (Number(burst.n) >= cfg.ipSignupsPerDay) flags.push('ip_burst');
  }
  const [today, week] = await Promise.all([
    trx.selectFrom('galaxy.referrals').select(sql<number>`count(*)::int`.as('n')).where('code_id', '=', row.id).where('created_at', '>', since(1)).executeTakeFirstOrThrow(),
    trx.selectFrom('galaxy.referrals').select(sql<number>`count(*)::int`.as('n')).where('owner_id', '=', row.owner_id).where('created_at', '>', since(7)).executeTakeFirstOrThrow(),
  ]);
  if (Number(today.n) >= cfg.perCodePerDay) flags.push('code_cap');
  if (Number(week.n) >= cfg.ownerPerWeek) flags.push('owner_cap');

  await trx
    .insertInto('galaxy.referrals')
    .values({ account_id: newcomer.id, code_id: row.id, owner_id: row.owner_id, signup_ip: newcomer.ip, user_agent: newcomer.userAgent?.slice(0, 400) ?? null, state: flags.length > 0 ? 'held' : 'pending', flags })
    .execute();
  if (flags.length === 0) await payNewcomer(trx, { account_id: newcomer.id, owner_id: row.owner_id, code: row.code }, await rulesFor(trx, row.owner_id, cfg), out);
}

/**
 * The newcomer reached a level: past the owner's level, the referral is active from now on (once) and, unless it is
 * held or rejected, the owner is paid. Cheap when there is nothing to do (one lookup by the account's key).
 */
export async function onLevel(db: Db, cfg: ReferralsConfig, accountId: string, level: number, out?: Notices): Promise<void> {
  const r = await db
    .selectFrom('galaxy.referrals as r')
    .innerJoin('galaxy.referral_codes as c', 'c.id', 'r.code_id')
    .select(['r.account_id', 'r.owner_id', 'r.state', 'c.code'])
    .where('r.account_id', '=', accountId)
    .where('r.activated_at', 'is', null)
    .where('r.state', 'in', ['pending', 'held'])
    .executeTakeFirst();
  if (!r) return;
  const rules = await rulesFor(db, r.owner_id, cfg);
  if (level < rules.activationLevel) return;
  await inTransaction(db, async (trx) => {
    const won = await trx
      .updateTable('galaxy.referrals')
      .set({ activated_at: sql<Date>`now()` })
      .where('account_id', '=', accountId)
      .where('activated_at', 'is', null)
      .returning(['state'])
      .executeTakeFirst();
    if (won?.state === 'pending') await payOwner(trx, r, rules, out);
  });
}

// ——— Admin ———

async function ownerAccount(db: Db, username: string): Promise<{ id: string; username: string }> {
  const a = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('username', '=', username.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst();
  if (!a) throw new HttpError(404, 'player_not_found');
  return a;
}

/** A code made from the owner's name: up to 12 of its letters and 4 random ones (no look-alikes). */
function codeFrom(username: string): string {
  const head = username.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'CLUB';
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const tail = [...randomBytes(4)].map((b) => letters[b % letters.length]).join('');
  return `${head}-${tail}`;
}

const codeRows = (db: Db) =>
  db
    .selectFrom('galaxy.referral_codes as c')
    .innerJoin('galaxy.accounts as o', 'o.id', 'c.owner_id')
    .leftJoin('galaxy.accounts as by', 'by.id', 'c.created_by')
    .select([
      'c.id',
      'c.code',
      'o.username as owner',
      'c.enabled',
      'c.max_uses',
      'c.expires_at',
      'c.note',
      'c.created_at',
      'by.username as created_by',
      sql<number>`(select count(*)::int from galaxy.referrals r where r.code_id = c.id)`.as('uses'),
      sql<number>`(select count(*)::int from galaxy.referrals r where r.code_id = c.id and r.state = 'rewarded')`.as('rewarded'),
      sql<number>`(select count(*)::int from galaxy.referrals r where r.code_id = c.id and r.state = 'held')`.as('held'),
    ]);

type CodeRow = Awaited<ReturnType<ReturnType<typeof codeRows>['execute']>>[number];
const codeView = (r: CodeRow): AdminReferralCode => ({
  id: r.id,
  code: r.code,
  owner: r.owner,
  enabled: r.enabled,
  maxUses: r.max_uses,
  expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  note: r.note,
  createdAt: new Date(r.created_at).toISOString(),
  createdBy: r.created_by,
  uses: Number(r.uses),
  rewarded: Number(r.rewarded),
  held: Number(r.held),
});

export async function listCodes(db: Db, q?: string): Promise<AdminReferralCode[]> {
  let query = codeRows(db).orderBy('c.created_at', 'desc').limit(500);
  if (q) query = query.where((eb) => eb.or([eb('c.code', 'ilike', `%${q.toUpperCase()}%`), eb('o.username', 'ilike', `%${q.toLowerCase()}%`)]));
  return (await query.execute()).map(codeView);
}

export async function createCode(
  db: Db,
  actor: AuditActor,
  body: { owner: string; code?: string; maxUses?: number | null; expiresAt?: string | null; note?: string | null; reason: string },
): Promise<AdminReferralCode> {
  const owner = await ownerAccount(db, body.owner);
  // Staff never own a code (the owner: codes are for veteran players).
  if ((await rolesOf(db, owner.id)).length > 0) throw new HttpError(409, 'staff_target');
  try {
    const id = await inTransaction(db, async (trx) => {
      const made = await trx
        .insertInto('galaxy.referral_codes')
        .values({ code: body.code ?? codeFrom(owner.username), owner_id: owner.id, max_uses: body.maxUses ?? null, expires_at: body.expiresAt ?? null, note: body.note ?? null, created_by: actor.id })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, { actor, action: 'referral.code.create', targetType: 'account', targetId: owner.id, after: { code: made.code, maxUses: body.maxUses ?? null, expiresAt: body.expiresAt ?? null }, reason: body.reason });
      return made.id;
    });
    return codeView((await codeRows(db).where('c.id', '=', id).executeTakeFirstOrThrow()));
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'referral_code_taken');
    throw err;
  }
}

export async function updateCode(
  db: Db,
  actor: AuditActor,
  id: string,
  body: { enabled?: boolean; maxUses?: number | null; expiresAt?: string | null; note?: string | null; reason: string },
): Promise<AdminReferralCode> {
  await inTransaction(db, async (trx) => {
    const before = await trx.selectFrom('galaxy.referral_codes').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!before) throw new HttpError(404, 'referral_code_not_found');
    const patch = {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.maxUses !== undefined ? { max_uses: body.maxUses } : {}),
      ...(body.expiresAt !== undefined ? { expires_at: body.expiresAt } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    };
    if (Object.keys(patch).length > 0) await trx.updateTable('galaxy.referral_codes').set(patch).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'referral.code.update', targetType: 'referral_code', targetId: id, before: { enabled: before.enabled, maxUses: before.max_uses, expiresAt: before.expires_at, note: before.note }, after: patch, reason: body.reason });
  });
  return codeView(await codeRows(db).where('c.id', '=', id).executeTakeFirstOrThrow());
}

export async function listReferrals(db: Db, account: AccountConfig, q: AdminReferralList): Promise<{ rows: AdminReferralRow[]; total: number; page: number; pages: number }> {
  let query = db
    .selectFrom('galaxy.referrals as r')
    .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
    .innerJoin('galaxy.accounts as o', 'o.id', 'r.owner_id')
    .innerJoin('galaxy.referral_codes as c', 'c.id', 'r.code_id')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'r.account_id')
    .leftJoin('galaxy.accounts as rv', 'rv.id', 'r.reviewed_by');
  if (q.state) query = query.where('r.state', '=', q.state);
  if (q.flagged) query = query.where(sql<boolean>`cardinality(r.flags) > 0`);
  if (q.q) {
    const like = `%${q.q.toLowerCase()}%`;
    query = query.where((eb) => eb.or([eb('a.username', 'ilike', like), eb('o.username', 'ilike', like), eb('c.code', 'ilike', `%${q.q!.toUpperCase()}%`)]));
  }
  const total = Number((await query.select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n);
  const rows = await query
    .select(['a.username', 'c.code', 'o.username as owner', 'r.created_at', 'r.state', 'r.flags', sql<string | null>`host(r.signup_ip)`.as('ip'), 'r.user_agent', 'x.xp', 'r.activated_at', 'r.newcomer_paid_at', 'r.owner_paid_at', 'rv.username as reviewed_by'])
    .orderBy('r.created_at', 'desc')
    .limit(PAGE)
    .offset((q.page - 1) * PAGE)
    .execute();
  return {
    rows: rows.map((r) => ({
      username: r.username,
      code: r.code,
      owner: r.owner,
      createdAt: new Date(r.created_at).toISOString(),
      state: r.state,
      flags: r.flags as ReferralFlag[],
      ip: r.ip,
      userAgent: r.user_agent,
      level: levelOf(Number(r.xp ?? 0), account).level,
      activatedAt: r.activated_at ? new Date(r.activated_at).toISOString() : null,
      newcomerPaid: r.newcomer_paid_at !== null,
      ownerPaid: r.owner_paid_at !== null,
      reviewedBy: r.reviewed_by,
    })),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / PAGE)),
  };
}

/** An admin decides on a held sign-up: approving pays what was held (the owner too if the newcomer is past the level). */
export async function reviewReferral(db: Db, cfg: ReferralsConfig, actor: AuditActor, username: string, decision: 'approve' | 'reject', reason: string, out?: Notices): Promise<void> {
  const account = await ownerAccount(db, username);
  await inTransaction(db, async (trx) => {
    const r = await trx
      .selectFrom('galaxy.referrals as r')
      .innerJoin('galaxy.referral_codes as c', 'c.id', 'r.code_id')
      .select(['r.account_id', 'r.owner_id', 'r.state', 'r.activated_at', 'r.newcomer_paid_at', 'c.code'])
      .where('r.account_id', '=', account.id)
      .forUpdate()
      .executeTakeFirst();
    if (!r) throw new HttpError(404, 'referral_not_found');
    if (r.state !== 'held') throw new HttpError(409, 'referral_not_held');
    await trx.updateTable('galaxy.referrals').set({ state: decision === 'approve' ? 'pending' : 'rejected', reviewed_by: actor.id, reviewed_at: sql<Date>`now()` }).where('account_id', '=', account.id).execute();
    if (decision === 'approve') {
      const rules = await rulesFor(trx, r.owner_id, cfg);
      if (!r.newcomer_paid_at) await payNewcomer(trx, r, rules, out);
      if (r.activated_at) await payOwner(trx, r, rules, out);
    }
    await writeAudit(trx, { actor, action: `referral.${decision}`, targetType: 'account', targetId: account.id, before: { state: r.state }, after: { state: decision === 'approve' ? (r.activated_at ? 'rewarded' : 'pending') : 'rejected' }, reason });
  });
}

export async function ownerRules(db: Db, cfg: ReferralsConfig, username: string): Promise<AdminReferralOwner> {
  const owner = await ownerAccount(db, username);
  const override = await overrideOf(db, owner.id);
  return { owner: owner.username, override, rules: referralRules(globalRules(cfg), override) };
}

export async function setOwnerRules(db: Db, cfg: ReferralsConfig, actor: AuditActor, username: string, body: ReferralOverride & { reason: string }): Promise<AdminReferralOwner> {
  const owner = await ownerAccount(db, username);
  await inTransaction(db, async (trx) => {
    const before = await overrideOf(trx, owner.id);
    const empty = body.ownerGifts === null && body.newcomerGifts === null && body.activationLevel === null;
    if (empty) await trx.deleteFrom('galaxy.referral_rewards').where('owner_id', '=', owner.id).execute();
    else {
      const values = {
        owner_gifts: body.ownerGifts ? JSON.stringify(body.ownerGifts) : null,
        newcomer_gifts: body.newcomerGifts ? JSON.stringify(body.newcomerGifts) : null,
        activation_level: body.activationLevel,
        updated_by: actor.id,
        updated_at: new Date(),
      };
      await trx.insertInto('galaxy.referral_rewards').values({ owner_id: owner.id, ...values }).onConflict((oc) => oc.column('owner_id').doUpdateSet(values)).execute();
    }
    await writeAudit(trx, { actor, action: 'referral.rewards', targetType: 'account', targetId: owner.id, before, after: empty ? null : { ownerGifts: body.ownerGifts, newcomerGifts: body.newcomerGifts, activationLevel: body.activationLevel }, reason: body.reason });
  });
  return ownerRules(db, cfg, owner.username);
}

export async function referralSummary(db: Db): Promise<AdminReferralSummary> {
  const [codes, signups, act] = await Promise.all([
    db.selectFrom('galaxy.referral_codes').select([sql<number>`count(*) filter (where enabled and (expires_at is null or expires_at > now()))::int`.as('active'), sql<number>`count(*)::int`.as('total')]).executeTakeFirstOrThrow(),
    db
      .selectFrom('galaxy.referrals')
      .select([
        sql<number>`count(*) filter (where created_at > now() - interval '7 days')::int`.as('days7'),
        sql<number>`count(*) filter (where created_at > now() - interval '30 days')::int`.as('days30'),
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(*) filter (where state = 'held')::int`.as('held'),
        sql<number>`count(*) filter (where state = 'rewarded')::int`.as('rewarded'),
      ])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('galaxy.referrals')
      .select([sql<number>`count(*)::int`.as('old'), sql<number>`count(*) filter (where activated_at is not null)::int`.as('active')])
      .where('created_at', '<', new Date(Date.now() - DAY))
      .executeTakeFirstOrThrow(),
  ]);
  return {
    codes: { active: Number(codes.active), total: Number(codes.total) },
    signups: { days7: Number(signups.days7), days30: Number(signups.days30), total: Number(signups.total) },
    activation: Number(act.old) > 0 ? Number(act.active) / Number(act.old) : 0,
    held: Number(signups.held),
    rewarded: Number(signups.rewarded),
  };
}

// ——— Player ———

export async function myReferrals(db: Db, cfg: ReferralsConfig, accountId: string): Promise<MyReferrals> {
  const [codes, counts, rules] = await Promise.all([
    db
      .selectFrom('galaxy.referral_codes as c')
      .select(['c.code', 'c.enabled', 'c.max_uses', 'c.expires_at', sql<number>`(select count(*)::int from galaxy.referrals r where r.code_id = c.id)`.as('uses')])
      .where('c.owner_id', '=', accountId)
      .orderBy('c.created_at', 'desc')
      .execute(),
    db
      .selectFrom('galaxy.referrals')
      .select([sql<number>`count(*)::int`.as('joined'), sql<number>`count(*) filter (where state in ('pending', 'held'))::int`.as('waiting'), sql<number>`count(*) filter (where state = 'rewarded')::int`.as('rewarded')])
      .where('owner_id', '=', accountId)
      .executeTakeFirstOrThrow(),
    rulesFor(db, accountId, cfg),
  ]);
  return {
    codes: codes.map((c) => ({ code: c.code, enabled: c.enabled, uses: Number(c.uses), maxUses: c.max_uses, expiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null })),
    joined: Number(counts.joined),
    waiting: Number(counts.waiting),
    rewarded: Number(counts.rewarded),
    activationLevel: rules.activationLevel,
    ownerGifts: rules.ownerGifts,
    newcomerGifts: rules.newcomerGifts,
  };
}
