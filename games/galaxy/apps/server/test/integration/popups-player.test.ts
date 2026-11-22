import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_CHAT_WORDS, type PopupAnswerResult, type PopupNext, type PopupRecordInput, popupRecordSchema } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { recordColumns } from '../../src/popups/records';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// «Encuestas y avisos» for players (plan 2026-11-22, part A; GDD §16.5) against the real database: reading which popup
// to show never spends a show; a show is counted at most three times, never twice the same Madrid day, and only one
// popup a day over every campaign; «Más tarde» once per show; a promotion is closed (maybe through «Ver más»); an
// answer is kept once with its reward (never to a newer account, to who published it nor to staff), its texts through
// the word filter, and a campaign shown before its end still takes answers for 15 minutes. Every campaign here reaches
// only this file's players by name.

let clock: Date | null = null;
type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
const H = 3_600_000;
const DAY = 24 * H;
const coins = (amount: number) => ({ kind: 'currency' as const, currency: 'coins' as const, amount });
const enemy = DEFAULT_CONTENT.enemies[0]!;

beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}), now: () => clock ?? new Date() });
});
afterEach(() => {
  clock = null;
});
afterAll(() => ctx.close());

type Player = { id: string; username: string; cookie: string };
async function player(name = 'popj'): Promise<Player> {
  const username = uniqueName(name);
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  expect(res.statusCode, res.body).toBe(201);
  return { id: (res.json() as { id: string }).id, username, cookie: sessionCookie(res) };
}

async function staff(role: 'admin' | 'superadmin'): Promise<Player> {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  const id = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;
  return { id, username, cookie: sessionCookie(res) };
}

/**
 * A published campaign straight in the table: by default open since an hour ago for three days, and published a minute
 * ahead (after this file's players, whatever the database's and the server's clocks say).
 */
async function campaign(to: Player[], over: Partial<PopupRecordInput> = {}, opts: { publishedBy?: string | null; publishedAt?: Date; endedAt?: Date } = {}): Promise<string> {
  const now = Date.now();
  const p = popupRecordSchema.parse({
    kind: 'survey',
    title: '¿Nos recomiendas?',
    questions: [{ type: 'scale', id: 'nps', prompt: '¿Recomendarías el juego?', range: '0-10' }],
    audience: { kind: 'segment', usernames: to.map((x) => x.username) },
    startsAt: new Date(now - H).toISOString(),
    endsAt: new Date(now + 3 * DAY).toISOString(),
    ...over,
  });
  const { id } = await ctx.db.insertInto('galaxy.popup_campaigns').values(recordColumns(p)).returning('id').executeTakeFirstOrThrow();
  await ctx.db
    .updateTable('galaxy.popup_campaigns')
    .set({ state: 'published', published_at: opts.publishedAt ?? new Date(now + 60_000), published_by: opts.publishedBy ?? null, ...(opts.endedAt ? { ended_at: opts.endedAt } : {}) })
    .where('id', '=', id)
    .execute();
  return id;
}

async function image(): Promise<string> {
  const data = randomBytes(16);
  const sha256 = randomBytes(32).toString('hex');
  return (await ctx.db.insertInto('galaxy.media_assets').values({ name: 'promo.png', mime: 'image/png', bytes: data.length, width: 2, height: 1, sha256, data, created_by: null }).returning('id').executeTakeFirstOrThrow()).id;
}

const next = async (p: Player) => {
  const res = await get(ctx.app, '/galaxy/api/popups/next', { cookie: p.cookie });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as PopupNext).popup;
};
const shown = (p: Player, id: string) => post(ctx.app, `/galaxy/api/popups/${id}/shown`, undefined, { cookie: p.cookie });
const later = (p: Player, id: string) => post(ctx.app, `/galaxy/api/popups/${id}/later`, undefined, { cookie: p.cookie });
const seen = (p: Player, id: string, clicked: boolean) => post(ctx.app, `/galaxy/api/popups/${id}/seen`, { clicked }, { cookie: p.cookie });
const answer = (p: Player, id: string, answers: unknown[], key = randomUUID()) => post(ctx.app, `/galaxy/api/popups/${id}/answer`, { answers }, { cookie: p.cookie, headers: { 'idempotency-key': key } });
const viewOf = (p: Player, id: string) =>
  ctx.db.selectFrom('galaxy.popup_views').selectAll().where('campaign_id', '=', id).where('account_id', '=', p.id).executeTakeFirst();
const coinsOf = async (id: string) => Number((await ctx.db.selectFrom('galaxy.balances').select('amount').where('account_id', '=', id).where('currency', '=', 'coins').executeTakeFirst())?.amount ?? 0);

describe('qué popup sale y cuándo', () => {
  test('sin campañas para ti, ninguno; leer no gasta una vista', async () => {
    const p = await player();
    expect(await next(p)).toBeNull();
    const id = await campaign([p], { questions: [{ type: 'scale', id: 'dif', prompt: '¿Es difícil?', range: '1-5', subject: { kind: 'enemy', id: enemy.id } }] });
    const popup = await next(p);
    expect(popup).toMatchObject({ id, kind: 'survey', title: '¿Nos recomiendas?', image: null, link: null, reward: [] });
    expect(popup!.questions[0]).toMatchObject({ type: 'scale', range: '1-5', subject: { kind: 'enemy', id: enemy.id, name: enemy.name, sprite: enemy.sprite } });
    expect(await next(p)).toMatchObject({ id });
    expect(await viewOf(p, id)).toBeUndefined();
  });

  test('tres veces como mucho, nunca dos el mismo día', async () => {
    const p = await player();
    const t0 = Date.now();
    const id = await campaign([p], { endsAt: new Date(t0 + 6 * DAY).toISOString() });
    expect((await shown(p, id)).statusCode).toBe(204);
    // A second render the same day changes nothing.
    expect((await shown(p, id)).statusCode).toBe(204);
    expect(await viewOf(p, id)).toMatchObject({ shows: 1 });
    expect(await next(p)).toBeNull();
    for (const day of [1, 2]) {
      clock = new Date(t0 + day * DAY);
      expect(await next(p)).toMatchObject({ id });
      expect((await shown(p, id)).statusCode).toBe(204);
    }
    expect(await viewOf(p, id)).toMatchObject({ shows: 3 });
    // Another day: it never comes back.
    clock = new Date(t0 + 3 * DAY);
    expect(await next(p)).toBeNull();
    const res = await shown(p, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('popup_closed');
  });

  test('uno al día como mucho entre todas las campañas, el de más prioridad', async () => {
    const p = await player();
    const low = await campaign([p], { priority: 0 });
    const high = await campaign([p], { priority: 2 });
    expect(await next(p)).toMatchObject({ id: high });
    expect((await shown(p, high)).statusCode).toBe(204);
    expect(await next(p)).toBeNull();
    // The server holds it, even for a client that asks for another one.
    expect((await shown(p, low)).json().error).toBe('popup_closed');
    expect(await viewOf(p, low)).toBeUndefined();
  });

  test('«Más tarde» cuenta una vez por vista', async () => {
    const p = await player();
    const id = await campaign([p]);
    expect((await later(p, id)).json().error).toBe('popup_not_found');
    await shown(p, id);
    expect((await later(p, id)).statusCode).toBe(204);
    expect((await later(p, id)).statusCode).toBe(204);
    expect(await viewOf(p, id)).toMatchObject({ shows: 1, dismissals: 1 });
  });

  test('las terminadas, las de otro público y las que no han empezado no salen', async () => {
    const p = await player();
    const ended = await campaign([p], {}, { endedAt: new Date() });
    const levels = await campaign([], { audience: { kind: 'segment', minLevel: 50 } });
    const soon = await campaign([p], { startsAt: new Date(Date.now() + H).toISOString() });
    expect(await next(p)).toBeNull();
    expect((await shown(p, ended)).json().error).toBe('popup_closed');
    expect((await shown(p, levels)).json().error).toBe('popup_not_found');
    expect((await shown(p, soon)).json().error).toBe('popup_not_found');
  });
});

describe('contestar', () => {
  test('una respuesta guarda lo contestado, paga el premio una vez y no vuelve a salir', async () => {
    const publisher = await staff('admin');
    const p = await player();
    const id = await campaign([p], { reward: [coins(500)] }, { publishedBy: publisher.id });
    expect(await next(p)).toMatchObject({ id, reward: [coins(500)] });
    // Never shown: nothing to answer.
    expect((await answer(p, id, [{ q: 'nps', score: 9 }])).json().error).toBe('popup_not_found');
    await shown(p, id);
    const before = await coinsOf(p.id);
    const key = randomUUID();
    const res = await answer(p, id, [{ q: 'nps', score: 9 }], key);
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json() as PopupAnswerResult;
    expect(out).toMatchObject({ skipped: null, granted: [{ gift: coins(500), outcome: 'granted' }] });
    expect(out.wallet.coins).toBe(before + 500);
    // The same key answers the same; another one is a second answer.
    expect((await answer(p, id, [{ q: 'nps', score: 9 }], key)).json()).toEqual(out);
    const again = await answer(p, id, [{ q: 'nps', score: 3 }]);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('popup_answered');
    expect(await coinsOf(p.id)).toBe(before + 500);
    expect(await ctx.db.selectFrom('galaxy.popup_answers').select(['question_id', 'score']).where('campaign_id', '=', id).where('account_id', '=', p.id).execute()).toEqual([{ question_id: 'nps', score: 9 }]);
    expect((await viewOf(p, id))?.done_at).not.toBeNull();
    clock = new Date(Date.now() + DAY);
    expect(await next(p)).toBeNull();
  });

  test('las respuestas que no valen se rechazan y los textos pasan el filtro', async () => {
    const p = await player();
    const word = DEFAULT_CHAT_WORDS[0]!;
    const id = await campaign([p], {
      kind: 'form',
      questions: [
        { type: 'stars', id: 'est', prompt: '¿Qué te parece?' },
        { type: 'text', id: 'por', prompt: '¿Por qué?', required: true, maxLength: 100 },
      ],
    });
    await shown(p, id);
    const bad = await answer(p, id, [{ q: 'est', score: 9 }]);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'popup_answers_invalid', issues: [{ q: 'est', code: 'answer_range' }, { q: 'por', code: 'answer_missing' }] });
    const ok = await answer(p, id, [
      { q: 'est', score: 4 },
      { q: 'por', text: `  Me parece  de ${word}  ` },
    ]);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ granted: null, skipped: null });
    const text = await ctx.db.selectFrom('galaxy.popup_answers').select('text').where('campaign_id', '=', id).where('question_id', '=', 'por').executeTakeFirstOrThrow();
    expect(text.text).toBe(`Me parece de ${'*'.repeat([...word].length)}`);
  });

  test('el premio no lo cobra una cuenta más nueva que la campaña', async () => {
    const p = await player();
    const id = await campaign([p], { reward: [coins(300)] }, { publishedAt: new Date(Date.now() - H) });
    expect(await next(p)).toMatchObject({ id, reward: [] });
    await shown(p, id);
    const before = await coinsOf(p.id);
    expect((await answer(p, id, [{ q: 'nps', score: 10 }])).json()).toMatchObject({ granted: null, skipped: 'newcomer' });
    expect(await coinsOf(p.id)).toBe(before);
    expect(await ctx.db.selectFrom('galaxy.popup_responses').select(['reward', 'reward_skipped']).where('campaign_id', '=', id).executeTakeFirstOrThrow()).toEqual({ reward: null, reward_skipped: 'newcomer' });
  });

  test('ni quien la publicó ni el equipo cobran el premio', async () => {
    const author = await staff('admin');
    const mate = await staff('admin');
    const id = await campaign([author, mate], { reward: [coins(200)] }, { publishedBy: author.id });
    for (const [who, why] of [
      [author, 'self'],
      [mate, 'staff'],
    ] as const) {
      expect(await next(who)).toMatchObject({ id, reward: [] });
      await shown(who, id);
      expect((await answer(who, id, [{ q: 'nps', score: 8 }])).json()).toMatchObject({ granted: null, skipped: why });
    }
  });

  test('una campaña vista antes de su fin admite respuestas 15 minutos más', async () => {
    const early = await player();
    const late = await player();
    const ends = Date.now() + 10 * 60_000;
    const id = await campaign([early, late], { endsAt: new Date(ends).toISOString() });
    await shown(early, id);
    await shown(late, id);
    clock = new Date(ends + 5 * 60_000);
    expect(await next(early)).toBeNull();
    expect((await answer(early, id, [{ q: 'nps', score: 7 }])).statusCode).toBe(200);
    clock = new Date(ends + 16 * 60_000);
    const res = await answer(late, id, [{ q: 'nps', score: 7 }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('popup_closed');
  });
});

describe('las promociones', () => {
  test('se cierran sin contestar, con o sin «Ver más», y no vuelven', async () => {
    const p = await player();
    const img = await image();
    const id = await campaign([p], { kind: 'promotion', questions: [], body: 'Ya está aquí', imageMedia: img, link: { kind: 'route', to: '/temporada', label: 'Ver la temporada' } });
    expect(await next(p)).toMatchObject({ id, kind: 'promotion', image: `/galaxy/api/media/${img}`, link: { kind: 'route', to: '/temporada' }, questions: [], reward: [] });
    await shown(p, id);
    expect((await answer(p, id, [])).json().error).toBe('popup_wrong_kind');
    expect((await seen(p, id, true)).statusCode).toBe(204);
    const v = await viewOf(p, id);
    expect(v?.done_at).not.toBeNull();
    expect(v?.clicked_at).not.toBeNull();
    clock = new Date(Date.now() + DAY);
    expect(await next(p)).toBeNull();
  });

  test('una encuesta no se cierra como una promoción', async () => {
    const p = await player();
    const id = await campaign([p]);
    await shown(p, id);
    expect((await seen(p, id, false)).json().error).toBe('popup_wrong_kind');
  });
});
