import { randomBytes, randomUUID } from 'node:crypto';
import { type AdminPopupResults, POPUP_TEXTS_PAGE, popupRecordSchema, type PopupTextsPage } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { recordColumns } from '../../src/popups/records';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The results of «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5) against the real database: what players did
// (saw it, answered, «Más tarde», will not see it again), each question summed up (a 0–10 scale's NPS, the stars' share
// of 4 and 5, a multiple choice's share of respondents), the texts 50 at a time with who wrote each, and the CSV that
// spreadsheets open without running a formula. Only admins read them.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
let admin: { cookie: string };
const H = 3_600_000;

beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  admin = { cookie: sessionCookie(res) };
});
afterAll(() => ctx.close());

type Player = { id: string; username: string; cookie: string };
async function player(): Promise<Player> {
  const username = uniqueName('popr');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  expect(res.statusCode, res.body).toBe(200);
  return { id: (res.json() as { id: string }).id, username, cookie: sessionCookie(res) };
}

const QUESTIONS = [
  { type: 'scale', id: 'nps', prompt: '¿Nos recomendarías?', range: '0-10' },
  { type: 'stars', id: 'est', prompt: '¿Qué te parece?' },
  {
    type: 'choice',
    id: 'gusta',
    prompt: '¿Qué te gusta?',
    multi: true,
    options: [
      { id: 'arte', label: 'El arte' },
      { id: 'musica', label: 'La música' },
      { id: 'escaner', label: 'El escáner' },
    ],
  },
  { type: 'text', id: 'idea', prompt: '¿Alguna idea?' },
];

async function campaign(usernames: string[]): Promise<string> {
  const p = popupRecordSchema.parse({
    kind: 'form',
    title: 'Tu opinión',
    questions: QUESTIONS,
    audience: { kind: 'segment', usernames },
    startsAt: new Date(Date.now() - H).toISOString(),
    endsAt: new Date(Date.now() + 48 * H).toISOString(),
  });
  const { id } = await ctx.db.insertInto('galaxy.popup_campaigns').values(recordColumns(p)).returning('id').executeTakeFirstOrThrow();
  await ctx.db.updateTable('galaxy.popup_campaigns').set({ state: 'published', published_at: new Date() }).where('id', '=', id).execute();
  return id;
}

const A = (id: string, path: string) => `/galaxy/api/admin/popups/${id}${path}`;
const answer = (p: Player, id: string, answers: unknown[]) => post(ctx.app, `/galaxy/api/popups/${id}/answer`, { answers }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });

describe('los resultados de una campaña', () => {
  let id: string;
  const players: Player[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) players.push(await player());
    const idle = await player();
    players.push(idle);
    id = await campaign(players.map((p) => p.username));
    for (const p of players) expect((await post(ctx.app, `/galaxy/api/popups/${id}/shown`, undefined, { cookie: p.cookie })).statusCode).toBe(204);
    // The sixth only puts it off.
    expect((await post(ctx.app, `/galaxy/api/popups/${id}/later`, undefined, { cookie: idle.cookie })).statusCode).toBe(204);
    const sent = [
      { nps: 10, est: 5, gusta: ['arte', 'escaner'], idea: 'Más Núcleos' },
      { nps: 9, est: 4, gusta: ['arte'], idea: '=1+1' },
      { nps: 8, est: 3, gusta: ['musica', 'arte'] },
      { nps: 6, est: 2, gusta: ['escaner'], idea: 'Un modo, con comas' },
      { nps: 0, est: 1, gusta: ['arte'] },
    ];
    for (const [i, s] of sent.entries()) {
      const res = await answer(players[i]!, id, [
        { q: 'nps', score: s.nps },
        { q: 'est', score: s.est },
        { q: 'gusta', choices: s.gusta },
        ...(s.idea ? [{ q: 'idea', text: s.idea }] : []),
      ]);
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  test('los totales y cada pregunta resumida', async () => {
    const res = await get(ctx.app, A(id, '/results'), { cookie: admin.cookie });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json() as AdminPopupResults;
    expect(r.popup).toMatchObject({ id, state: 'live', counts: { seen: 6, answered: 5, clicked: 0 } });
    expect(r.totals).toEqual({ seen: 6, answered: 5, later: 1, exhausted: 0, rewarded: 0, closed: 5, clicked: 0 });
    const [nps, est, gusta, idea] = r.questions;
    // Promoters 2, passives 1, detractors 2: 40 % − 40 % = 0.
    expect(nps).toMatchObject({ type: 'scale', id: 'nps', n: 5, nps: { score: 0, promoters: 2, passives: 1, detractors: 2 }, average: 33 / 5 });
    expect(est).toMatchObject({ type: 'stars', n: 5, topBox: 40, average: 3 });
    expect(gusta).toMatchObject({ type: 'choice', multi: true, n: 5 });
    expect(gusta?.type === 'choice' && gusta.options).toEqual([
      { id: 'arte', label: 'El arte', count: 4, pct: 80 },
      { id: 'escaner', label: 'El escáner', count: 2, pct: 40 },
      { id: 'musica', label: 'La música', count: 1, pct: 20 },
    ]);
    expect(idea).toEqual({ type: 'text', id: 'idea', n: 3 });
  });

  test('los textos con quien los escribió, de 50 en 50', async () => {
    // Fifty more texts, straight in the tables.
    const extra = await ctx.db
      .insertInto('galaxy.accounts')
      .values(Array.from({ length: POPUP_TEXTS_PAGE }, () => ({ username: `popt_${randomBytes(5).toString('hex')}`, password_hash: 'x' })))
      .returning('id')
      .execute();
    await ctx.db
      .insertInto('galaxy.popup_responses')
      .values(extra.map((a, i) => ({ campaign_id: id, account_id: a.id, op_key: `prueba-${i}` })))
      .execute();
    await ctx.db
      .insertInto('galaxy.popup_answers')
      .values(extra.map((a, i) => ({ campaign_id: id, account_id: a.id, question_id: 'idea', text: `Idea ${i}` })))
      .execute();
    const first = (await get(ctx.app, A(id, '/texts?question=idea'), { cookie: admin.cookie })).json() as PopupTextsPage;
    expect(first).toMatchObject({ question: 'idea', total: POPUP_TEXTS_PAGE + 3 });
    expect(first.texts).toHaveLength(POPUP_TEXTS_PAGE);
    expect(first.texts[0]).toMatchObject({ text: `Idea ${POPUP_TEXTS_PAGE - 1}` });
    expect(first.next).not.toBeNull();
    const second = (await get(ctx.app, A(id, `/texts?question=idea&cursor=${first.next}`), { cookie: admin.cookie })).json() as PopupTextsPage;
    expect(second.next).toBeNull();
    expect(second.texts.map((t) => t.text)).toEqual(['Un modo, con comas', '=1+1', 'Más Núcleos']);
    expect(second.texts.map((t) => t.username)).toEqual([players[3]!.username, players[1]!.username, players[0]!.username]);
    expect((await get(ctx.app, A(id, '/texts?question=nps'), { cookie: admin.cookie })).json().error).toBe('popup_not_found');
  });

  test('el CSV lleva una fila por respuesta y nunca una fórmula', async () => {
    const res = await get(ctx.app, A(id, '/results.csv'), { cookie: admin.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const body = res.body;
    expect(body.startsWith('﻿')).toBe(true);
    const lines = body.slice(1).trimEnd().split('\n');
    expect(lines[0]).toBe('fecha,usuario,¿Nos recomendarías?,¿Qué te parece?,¿Qué te gusta?,¿Alguna idea?');
    const mine = lines.find((l) => l.includes(players[1]!.username))!;
    expect(mine.endsWith(",9,4,El arte,'=1+1")).toBe(true);
    expect(lines.find((l) => l.includes(players[2]!.username))).toContain(',8,3,El arte; La música,');
    expect(lines.find((l) => l.includes(players[3]!.username))).toContain('"Un modo, con comas"');
  });

  test('un jugador no los lee', async () => {
    const p = players[0]!;
    expect((await get(ctx.app, A(id, '/results'), { cookie: p.cookie })).statusCode).toBe(403);
    expect((await get(ctx.app, A(id, '/texts?question=idea'), { cookie: p.cookie })).statusCode).toBe(403);
    expect((await get(ctx.app, A(id, '/results.csv'), { cookie: p.cookie })).statusCode).toBe(403);
  });
});
