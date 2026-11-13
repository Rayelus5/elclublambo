import { type AdminReferralCode, type AdminReferralRow, levelOf, type MyMailbox, type MyReferrals, parseConfig, type Role } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAdminViaCli, fixedConfig, get, post, put, randomIp, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Referrals (plan «referidos»; the owner): admins give a veteran a code; a new player signs up with it and gets the
// newcomer's gift in the mailbox; the owner gets theirs when the newcomer reaches the level. A sign-up from the same
// address as the owner (or another newcomer of the code, or too many from one address) is created but held: nothing
// is paid until an admin approves it. The owner's own gifts replace the global ones.

type Ctx = Awaited<ReturnType<typeof testApp>>;
const GIFTS = { ownerGifts: { coins: 100, dust: 50, signal: 2 }, newcomerGifts: { coins: 40, dust: 20 }, activationLevel: 2 };
let ctx: Ctx;
let admin: string;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ referrals: GIFTS }) });
  admin = await staff(ctx, 'admin');
});
afterAll(() => ctx.close());

async function staff(c: Ctx, role: Role): Promise<string> {
  const { username, password, totpSecret } = await createAdminViaCli(c.db, role);
  const login = await post(c.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(c.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  return sessionCookie(res);
}

async function signUp(c: Ctx, opts: { code?: string; ip?: string } = {}) {
  const username = uniqueName('ref');
  const res = await post(c.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga', ...(opts.code ? { referralCode: opts.code } : {}) }, { ip: opts.ip ?? randomIp() });
  return { res, username, cookie: res.statusCode === 201 ? sessionCookie(res) : '', id: res.statusCode === 201 ? (res.json() as { id: string }).id : '' };
}

async function codeFor(c: Ctx, owner: string, extra: Record<string, unknown> = {}): Promise<AdminReferralCode> {
  const res = await post(c.app, '/galaxy/api/admin/referrals/codes', { owner, reason: 'Veterano de la beta', ...extra }, { cookie: admin });
  expect(res.statusCode).toBe(200);
  return res.json() as AdminReferralCode;
}

const mailbox = async (c: Ctx, cookie: string) => (await get(c.app, '/galaxy/api/mailbox', { cookie })).json() as MyMailbox;
const gifts = async (c: Ctx, cookie: string) => (await mailbox(c, cookie)).messages.filter((m) => Object.values(m.gifts ?? {}).some((n) => (n ?? 0) > 0)).map((m) => m.gifts);

/** Enough experience for a level (the account config's own curve). */
function xpFor(level: number): number {
  const cfg = parseConfig('account', {});
  let xp = 0;
  while (levelOf(xp, cfg).level < level) xp += 10;
  return xp;
}
async function reachLevel(c: Ctx, account: string, cookie: string, level: number) {
  await c.db.insertInto('galaxy.account_xp').values({ account_id: account, xp: xpFor(level), updated_at: new Date() }).onConflict((oc) => oc.column('account_id').doUpdateSet({ xp: xpFor(level) })).execute();
  // Any page of the game reads the account (its level): that is where the owner's gift is checked too.
  expect((await get(c.app, '/galaxy/api/auth/me', { cookie })).statusCode).toBe(200);
}

describe('registro con código', () => {
  test('sin código obligatorio, el formulario lo sabe antes de entrar', async () => {
    const res = await get(ctx.app, '/galaxy/api/auth/signup-options', { cookie: undefined });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ referralRequired: false });
    const plain = await signUp(ctx);
    expect(plain.res.statusCode).toBe(201);
  });

  test('el nuevo recibe su regalo al momento; el dueño, cuando el nuevo llega al nivel, y solo una vez', async () => {
    const ownerIp = randomIp();
    const owner = await signUp(ctx, { ip: ownerIp });
    const { code } = await codeFor(ctx, owner.username);
    const newcomer = await signUp(ctx, { code: code.toLowerCase() });
    expect(newcomer.res.statusCode).toBe(201);
    expect(await gifts(ctx, newcomer.cookie)).toEqual([{ coins: 40, dust: 20 }]);
    expect(await gifts(ctx, owner.cookie)).toEqual([]);
    await reachLevel(ctx, newcomer.id, newcomer.cookie, 2);
    expect(await gifts(ctx, owner.cookie)).toEqual([{ coins: 100, dust: 50, signal: 2 }]);
    // Reading the account again pays nothing more.
    await get(ctx.app, '/galaxy/api/auth/me', { cookie: newcomer.cookie });
    expect(await gifts(ctx, owner.cookie)).toHaveLength(1);
    const mine = (await get(ctx.app, '/galaxy/api/referrals/mine', { cookie: owner.cookie })).json() as MyReferrals;
    expect(mine).toMatchObject({ joined: 1, waiting: 0, rewarded: 1, activationLevel: 2 });
    expect(mine.codes.map((c) => c.code)).toEqual([code]);
  });

  test('un código que no existe, apagado, caducado o gastado no deja usarlo', async () => {
    const owner = await signUp(ctx);
    expect((await signUp(ctx, { code: 'NOEXISTE-99' })).res.json()).toEqual({ error: 'referral_invalid' });
    const off = await codeFor(ctx, owner.username);
    expect((await put(ctx.app, `/galaxy/api/admin/referrals/codes/${off.id}`, { enabled: false, reason: 'Pausa' }, { cookie: admin })).statusCode).toBe(200);
    const offTry = await signUp(ctx, { code: off.code });
    expect(offTry.res.statusCode).toBe(409);
    expect(offTry.res.json()).toEqual({ error: 'referral_unavailable' });
    const once = await codeFor(ctx, owner.username, { maxUses: 1 });
    expect((await signUp(ctx, { code: once.code })).res.statusCode).toBe(201);
    expect((await signUp(ctx, { code: once.code })).res.json()).toEqual({ error: 'referral_unavailable' });
    const old = await codeFor(ctx, owner.username, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await signUp(ctx, { code: old.code })).res.json()).toEqual({ error: 'referral_unavailable' });
  });

  test('con el código obligatorio, sin código no se crea la cuenta', async () => {
    const strict = await testApp({ config: fixedConfig({ referrals: { ...GIFTS, required: true } }) });
    try {
      expect((await get(strict.app, '/galaxy/api/auth/signup-options')).json()).toEqual({ referralRequired: true });
      const none = await signUp(strict);
      expect(none.res.statusCode).toBe(400);
      expect(none.res.json()).toEqual({ error: 'referral_required' });
    } finally {
      await strict.close();
    }
  });
});

describe('contra el abuso', () => {
  test('desde la misma dirección que el dueño: se crea, pero no se paga hasta revisarlo; aprobar paga a los dos', async () => {
    const ip = randomIp();
    const owner = await signUp(ctx, { ip });
    const { code } = await codeFor(ctx, owner.username);
    const alt = await signUp(ctx, { code, ip });
    expect(alt.res.statusCode).toBe(201);
    expect(await gifts(ctx, alt.cookie)).toEqual([]);
    await reachLevel(ctx, alt.id, alt.cookie, 2);
    expect(await gifts(ctx, owner.cookie)).toEqual([]);
    const list = (await get(ctx.app, `/galaxy/api/admin/referrals?q=${alt.username}`, { cookie: admin })).json() as { rows: AdminReferralRow[] };
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ username: alt.username, state: 'held', flags: ['owner_ip'] });
    const ok = await post(ctx.app, `/galaxy/api/admin/referrals/${alt.username}/review`, { decision: 'approve', reason: 'Son hermanos, lo comprobé' }, { cookie: admin });
    expect(ok.statusCode).toBe(200);
    expect(await gifts(ctx, alt.cookie)).toEqual([{ coins: 40, dust: 20 }]);
    // Already past the level: the owner is paid with the approval.
    expect(await gifts(ctx, owner.cookie)).toEqual([{ coins: 100, dust: 50, signal: 2 }]);
  });

  test('rechazar no paga nada, y varios desde una misma dirección quedan retenidos', async () => {
    const owner = await signUp(ctx);
    const { code } = await codeFor(ctx, owner.username);
    const shared = randomIp();
    const first = await signUp(ctx, { code, ip: shared });
    expect(await gifts(ctx, first.cookie)).toHaveLength(1);
    const second = await signUp(ctx, { code, ip: shared });
    expect(await gifts(ctx, second.cookie)).toEqual([]);
    const rows = ((await get(ctx.app, `/galaxy/api/admin/referrals?q=${second.username}`, { cookie: admin })).json() as { rows: AdminReferralRow[] }).rows;
    expect(rows[0]!.flags).toContain('sibling_ip');
    expect((await post(ctx.app, `/galaxy/api/admin/referrals/${second.username}/review`, { decision: 'reject', reason: 'Cuenta secundaria' }, { cookie: admin })).statusCode).toBe(200);
    await reachLevel(ctx, second.id, second.cookie, 2);
    expect(await gifts(ctx, second.cookie)).toEqual([]);
    expect(await gifts(ctx, owner.cookie)).toEqual([]);
  });
});

describe('contra el abuso, más fino (revisión de #174)', () => {
  test('en IPv6 cuenta la misma red /64, no solo la misma dirección', async () => {
    const owner = await signUp(ctx, { ip: '2001:db8:aa:1::10' });
    const { code } = await codeFor(ctx, owner.username);
    const alt = await signUp(ctx, { code, ip: '2001:db8:aa:1:ffff::2' });
    expect(alt.res.statusCode).toBe(201);
    expect(await gifts(ctx, alt.cookie)).toEqual([]);
    const rows = ((await get(ctx.app, `/galaxy/api/admin/referrals?q=${alt.username}`, { cookie: admin })).json() as { rows: AdminReferralRow[] }).rows;
    expect(rows[0]!.flags).toContain('owner_ip');
  });

  test('si el invitado juega después desde la dirección del dueño, el premio del dueño queda retenido', async () => {
    const home = randomIp();
    const owner = await signUp(ctx, { ip: home });
    const { code } = await codeFor(ctx, owner.username);
    const alt = await signUp(ctx, { code });
    expect(await gifts(ctx, alt.cookie)).toHaveLength(1);
    // The alt signs in again from the owner's home.
    const again = await post(ctx.app, '/galaxy/api/auth/login', { username: alt.username, password: 'una-clave-larga' }, { ip: home });
    expect(again.statusCode).toBe(200);
    await reachLevel(ctx, alt.id, alt.cookie, 2);
    expect(await gifts(ctx, owner.cookie)).toEqual([]);
    const rows = ((await get(ctx.app, `/galaxy/api/admin/referrals?q=${alt.username}`, { cookie: admin })).json() as { rows: AdminReferralRow[] }).rows;
    expect(rows[0]).toMatchObject({ state: 'held', flags: ['owner_ip'] });
  });

  test('el código de un dueño suspendido no se puede usar', async () => {
    const owner = await signUp(ctx);
    const { code } = await codeFor(ctx, owner.username);
    await ctx.db.updateTable('galaxy.accounts').set({ banned_until: new Date(Date.now() + 86_400_000), ban_reason: 'Prueba' }).where('id', '=', owner.id).execute();
    const res = await signUp(ctx, { code });
    expect(res.res.statusCode).toBe(409);
    expect(res.res.json()).toEqual({ error: 'referral_unavailable' });
  });

  test('los regalos de los referidos no llenan la lista de mensajes del panel', async () => {
    const owner = await signUp(ctx);
    const { code } = await codeFor(ctx, owner.username);
    const newcomer = await signUp(ctx, { code });
    const ours = (await mailbox(ctx, newcomer.cookie)).messages.map((m) => m.id);
    expect(ours).toHaveLength(1);
    const list = (await get(ctx.app, '/galaxy/api/admin/mail', { cookie: admin })).json() as { id: string }[];
    expect(list.map((m) => m.id)).not.toContain(ours[0]);
  });
});

describe('el panel', () => {
  test('los premios propios de un dueño sustituyen a los globales', async () => {
    const owner = await signUp(ctx);
    const { code } = await codeFor(ctx, owner.username);
    const set = await put(ctx.app, `/galaxy/api/admin/referrals/owners/${owner.username}`, { ownerGifts: { signal: 10 }, newcomerGifts: null, activationLevel: null, reason: 'Creador de contenido' }, { cookie: admin });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ rules: { ownerGifts: { signal: 10 }, newcomerGifts: { coins: 40, dust: 20 }, activationLevel: 2 } });
    const newcomer = await signUp(ctx, { code });
    await reachLevel(ctx, newcomer.id, newcomer.cookie, 2);
    expect(await gifts(ctx, owner.cookie)).toEqual([{ signal: 10 }]);
  });

  test('el personal no puede ser dueño de un código, y solo los admins ven los referidos', async () => {
    const mod = await staff(ctx, 'moderator');
    const me = (await get(ctx.app, '/galaxy/api/auth/me', { cookie: mod })).json() as { username: string };
    const res = await post(ctx.app, '/galaxy/api/admin/referrals/codes', { owner: me.username, reason: 'Prueba' }, { cookie: admin });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'staff_target' });
    const player = await signUp(ctx);
    for (const cookie of [player.cookie, mod]) {
      expect((await get(ctx.app, '/galaxy/api/admin/referrals', { cookie })).statusCode).toBe(403);
      expect((await get(ctx.app, '/galaxy/api/admin/referrals/codes', { cookie })).statusCode).toBe(403);
    }
    const summary = await get(ctx.app, '/galaxy/api/admin/referrals/summary', { cookie: admin });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ codes: { active: expect.any(Number) }, signups: { total: expect.any(Number) } });
  });
});
