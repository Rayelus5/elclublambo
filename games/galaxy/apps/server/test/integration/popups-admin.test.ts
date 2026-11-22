import { randomBytes } from 'node:crypto';
import { type AdminPopup, type AdminPopupList, type AdminMediaView, parseConfig, type PopupRecordInput, type PopupValidation } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// «Encuestas y avisos» in the panel (plan 2026-11-22, part A; GDD §16.5) against the real database: a record checked
// against what is live (its subject in the content, its image uploaded, its gifts possible), drafts saved and replaced
// at their version, published with the password (a superadmin for a big reward), taken back only before anyone saw it,
// ended once, deleted only as drafts, and every change audited. Published campaigns here only reach a name nobody has,
// so no other file's players ever see them.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
type Staff = { cookie: string; password: string; id: string };
let admin: Staff;
let superadmin: Staff;
/** Who prepares the campaigns of the last tests (each admin has its own limit of changes a minute). */
let organizer: Staff;
const limits = parseConfig('mailLimits', {});
const H = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * H).toISOString();
const NOBODY = { kind: 'segment' as const, usernames: [`nadie_${randomBytes(4).toString('hex')}`] };
const coins = (amount: number) => ({ kind: 'currency' as const, currency: 'coins' as const, amount });
const reason = 'Prueba de encuestas';
const A = (path = '') => `/galaxy/api/admin/popups${path}`;

async function staff(role: 'admin' | 'superadmin'): Promise<Staff> {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  const id = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;
  return { cookie: sessionCookie(res), password, id };
}

beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
  admin = await staff('admin');
  superadmin = await staff('superadmin');
  organizer = await staff('admin');
});
afterAll(() => ctx.close());

function survey(over: Partial<PopupRecordInput> = {}): PopupRecordInput {
  return {
    kind: 'survey',
    title: '¿Nos recomiendas?',
    questions: [{ type: 'scale', id: 'nps', prompt: '¿Recomendarías Galaxy Survivor?', range: '0-10', low: 'Nada', high: 'Mucho' }],
    audience: NOBODY,
    startsAt: at(24),
    endsAt: at(24 * 8),
    ...over,
  };
}

const create = async (record: PopupRecordInput, by: Staff = admin) => {
  const res = await post(ctx.app, A(), { record, reason }, { cookie: by.cookie });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as AdminPopup;
};
const publish = (p: AdminPopup, by: Staff = admin, password = by.password) => post(ctx.app, A(`/${p.id}/publish`), { version: p.version, reason, password }, { cookie: by.cookie });
const action = (p: AdminPopup, what: 'unpublish' | 'end', by: Staff = admin) => post(ctx.app, A(`/${p.id}/${what}`), { reason, password: by.password }, { cookie: by.cookie });
const audits = async (id: string) => (await ctx.db.selectFrom('galaxy.admin_audit_log').select('action').where('target_id', '=', id).orderBy('id').execute()).map((r) => r.action);
const messages = (body: { issues?: { message: string }[] }) => (body.issues ?? []).map((i) => i.message);

/** A PNG nobody uploaded before (a byte after IEND keeps it a PNG). */
async function upload(): Promise<string> {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGGAMAEH5Af/YT4MIAAAAAElFTkSuQmCC', 'base64');
  const res = await post(ctx.app, '/galaxy/api/admin/media', { name: 'promo.png', data: Buffer.concat([png, randomBytes(8)]).toString('base64') }, { cookie: admin.cookie });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: string }).id;
}

describe('el panel de encuestas y avisos', () => {
  test('un jugador no entra', async () => {
    const p = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('pop'), password: 'una-clave-larga' });
    const cookie = sessionCookie(p);
    expect((await get(ctx.app, A(), { cookie })).statusCode).toBe(403);
    expect((await post(ctx.app, A(), { record: survey(), reason }, { cookie })).statusCode).toBe(403);
  });

  test('la validación en vivo dice cada aviso y si hace falta un superadmin', async () => {
    const enemy = DEFAULT_CONTENT.enemies[0]!.id;
    const ok = (await post(ctx.app, A('/validate'), { record: survey({ questions: [{ type: 'scale', id: 'dif', prompt: '¿Es difícil?', range: '1-5', subject: { kind: 'enemy', id: enemy } }] }) }, { cookie: admin.cookie })).json() as PopupValidation;
    expect(ok).toEqual({ ok: true, issues: [], bigReasons: [] });
    const ghost = (await post(ctx.app, A('/validate'), { record: survey({ questions: [{ type: 'scale', id: 'dif', prompt: '¿Es difícil?', range: '1-5', subject: { kind: 'boss', id: 'no-existe' } }] }) }, { cookie: admin.cookie })).json() as PopupValidation;
    expect(messages(ghost)).toEqual(['popup_subject_unknown']);
    const promo = (await post(ctx.app, A('/validate'), { record: { kind: 'promotion', title: 'Temporada 2', startsAt: at(1), endsAt: at(48) } }, { cookie: admin.cookie })).json() as PopupValidation;
    expect(messages(promo)).toEqual(['popup_image_missing']);
    const big = (await post(ctx.app, A('/validate'), { record: survey({ reward: [coins(limits.currency.coins + 1)] }) }, { cookie: admin.cookie })).json() as PopupValidation;
    expect(big).toMatchObject({ ok: true, bigReasons: ['currency_coins'] });
    const seasonal = (await post(ctx.app, A('/validate'), { record: survey({ reward: [{ kind: 'seasonPoints', amount: 10 }] }) }, { cookie: admin.cookie })).json() as PopupValidation;
    expect(messages(seasonal)).toEqual(['popup_gift_seasonal']);
    const unknown = (await post(ctx.app, A('/validate'), { record: { kind: 'promotion', title: 'X', imageMedia: '00000000-0000-4000-8000-00000000dead', startsAt: at(1), endsAt: at(48) } }, { cookie: admin.cookie })).json() as PopupValidation;
    expect(messages(unknown)).toEqual(['popup_media_unknown']);
  });

  test('un borrador se guarda, se lista y se reemplaza a su versión, con auditoría', async () => {
    const draft = await create(survey());
    expect(draft).toMatchObject({ state: 'draft', version: 1, record: { kind: 'survey', priority: 1, reward: [] }, counts: { seen: 0, answered: 0, clicked: 0 }, bigReasons: [], publishedAt: null, endedAt: null, createdBy: admin.id });
    const list = (await get(ctx.app, A(), { cookie: admin.cookie })).json() as AdminPopupList;
    expect(list.popups.map((p) => p.id)).toContain(draft.id);
    expect((await get(ctx.app, A(`/${draft.id}`), { cookie: admin.cookie })).json()).toMatchObject({ id: draft.id, state: 'draft' });

    const edited = await post(ctx.app, A(`/${draft.id}`), { record: survey({ title: 'Cambiada', priority: 2 }), version: 1, reason }, { cookie: admin.cookie });
    expect(edited.json()).toMatchObject({ version: 2, record: { title: 'Cambiada', priority: 2 } });
    const stale = await post(ctx.app, A(`/${draft.id}`), { record: survey(), version: 1, reason }, { cookie: admin.cookie });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'popup_conflict', version: 2 });
    expect(await audits(draft.id)).toEqual(['popup.saved', 'popup.saved']);
    expect((await get(ctx.app, A('/00000000-0000-4000-8000-000000000000'), { cookie: admin.cookie })).json().error).toBe('popup_not_found');
  });

  test('una ficha que no vale no se guarda', async () => {
    const res = await post(ctx.app, A(), { record: survey({ questions: [] }), reason }, { cookie: admin.cookie });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('popup_invalid');
    expect(messages(res.json())).toContain('popup_survey_shape');
    // A draft may still miss what only publishing needs.
    await create({ kind: 'promotion', title: 'Sin imagen todavía', audience: NOBODY, startsAt: at(1), endsAt: at(48) });
  });

  test('publicar pide la contraseña y la versión revisada, y después la ficha ya no cambia', async () => {
    const draft = await create(survey());
    expect((await publish(draft, admin, 'otra-clave-mala')).json().error).toBe('password_wrong');
    expect((await publish({ ...draft, version: 7 })).json().error).toBe('popup_conflict');
    const res = await publish(draft);
    expect(res.statusCode, res.body).toBe(200);
    const published = res.json() as AdminPopup;
    expect(published).toMatchObject({ state: 'scheduled', version: 2, publishedBy: admin.id });
    expect(published.publishedAt).not.toBeNull();
    expect((await post(ctx.app, A(`/${draft.id}`), { record: survey({ title: 'Otra' }), version: 2, reason }, { cookie: admin.cookie })).json().error).toBe('popup_not_draft');
    expect((await post(ctx.app, A(`/${draft.id}/delete`), { reason }, { cookie: admin.cookie })).json().error).toBe('popup_not_draft');
    expect((await publish(published)).json().error).toBe('popup_not_draft');
    expect(await audits(draft.id)).toEqual(['popup.saved', 'popup.published']);
  });

  test('una que ya acabó no se publica', async () => {
    const draft = await create(survey({ startsAt: at(-48), endsAt: at(-1) }));
    const res = await publish(draft);
    expect(res.statusCode).toBe(400);
    expect(messages(res.json())).toEqual(['popup_end_past']);
  });

  test('un premio grande solo lo publica un superadmin', async () => {
    const draft = await create(survey({ reward: [coins(limits.currency.coins + 1)] }));
    expect(draft.bigReasons).toEqual(['currency_coins']);
    const refused = await publish(draft);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'popup_needs_superadmin', reasons: ['currency_coins'] });
    expect((await publish(draft, superadmin)).json()).toMatchObject({ state: 'scheduled', publishedBy: superadmin.id });
    expect((await ctx.db.selectFrom('galaxy.popup_campaigns').select('big').where('id', '=', draft.id).executeTakeFirstOrThrow()).big).toBe(true);
  });

  test('una promoción necesita su imagen, y su imagen ya no se borra', async () => {
    const draft = await create({ kind: 'promotion', title: 'Temporada 2', body: 'Ya está aquí', audience: NOBODY, startsAt: at(1), endsAt: at(48), link: { kind: 'route', to: '/temporada', label: 'Ver la temporada' } });
    const res = await publish(draft);
    expect(messages(res.json())).toEqual(['popup_image_missing']);
    const image = await upload();
    const withImage = (await post(ctx.app, A(`/${draft.id}`), { record: { kind: 'promotion', title: 'Temporada 2', body: 'Ya está aquí', imageMedia: image, audience: NOBODY, startsAt: at(1), endsAt: at(48) }, version: 1, reason }, { cookie: admin.cookie })).json() as AdminPopup;
    expect((await publish(withImage)).statusCode).toBe(200);
    const media = (await get(ctx.app, '/galaxy/api/admin/media', { cookie: admin.cookie })).json() as AdminMediaView;
    expect(media.assets.find((m) => m.id === image)?.uses).toBe(1);
    expect((await post(ctx.app, `/galaxy/api/admin/media/${image}/delete`, { reason }, { cookie: admin.cookie })).json().error).toBe('media_in_use');
  });

  test('se retira antes de empezar y sin vistas, y un borrador se borra', async () => {
    const p = (await publish(await create(survey(), organizer), organizer)).json() as AdminPopup;
    const back = await action(p, 'unpublish', organizer);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json()).toMatchObject({ state: 'draft', version: 3, publishedAt: null, publishedBy: null });
    expect((await action(p, 'unpublish', organizer)).json().error).toBe('popup_conflict');
    expect((await post(ctx.app, A(`/${p.id}/delete`), { reason }, { cookie: organizer.cookie })).statusCode).toBe(204);
    expect(await audits(p.id)).toEqual(['popup.saved', 'popup.published', 'popup.unpublished', 'popup.deleted']);
    expect((await get(ctx.app, A(`/${p.id}`), { cookie: admin.cookie })).statusCode).toBe(404);
  });

  test('una que ya empezó o que alguien vio no se retira: se termina, una vez', async () => {
    const live = (await publish(await create(survey({ startsAt: at(-1), endsAt: at(24) }), organizer), organizer)).json() as AdminPopup;
    expect(live.state).toBe('live');
    expect((await action(live, 'unpublish', organizer)).json().error).toBe('popup_started');

    const seen = (await publish(await create(survey(), organizer), organizer)).json() as AdminPopup;
    const viewer = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('popv'), password: 'una-clave-larga' });
    await ctx.db.insertInto('galaxy.popup_views').values({ campaign_id: seen.id, account_id: (viewer.json() as { id: string }).id, shows: 1, last_shown_day: '2026-01-01' }).execute();
    expect((await action(seen, 'unpublish', organizer)).json().error).toBe('popup_started');

    const ended = await action(live, 'end', organizer);
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json()).toMatchObject({ state: 'ended', endedBy: organizer.id });
    expect((await action(live, 'end', organizer)).json().error).toBe('popup_ended');
    expect((await action(live, 'unpublish', organizer)).json().error).toBe('popup_ended');
    expect(await audits(live.id)).toEqual(['popup.saved', 'popup.published', 'popup.ended']);

    const draft = await create(survey(), organizer);
    expect((await action(draft, 'end', organizer)).json().error).toBe('popup_conflict');
  });

  test('la lista cuenta quién lo vio, contestó y pulsó «Ver más»', async () => {
    const p = (await publish(await create(survey({ startsAt: at(-1), endsAt: at(24) }), organizer), organizer)).json() as AdminPopup;
    const ids: string[] = [];
    for (const name of ['popa', 'popb', 'popc']) ids.push(((await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName(name), password: 'una-clave-larga' })).json() as { id: string }).id);
    await ctx.db
      .insertInto('galaxy.popup_views')
      .values([
        { campaign_id: p.id, account_id: ids[0]!, shows: 1, last_shown_day: '2026-01-01', done_at: new Date(), clicked_at: new Date() },
        { campaign_id: p.id, account_id: ids[1]!, shows: 2, last_shown_day: '2026-01-02', dismissals: 1 },
        { campaign_id: p.id, account_id: ids[2]!, shows: 0 },
      ])
      .execute();
    await ctx.db.insertInto('galaxy.popup_responses').values({ campaign_id: p.id, account_id: ids[0]!, op_key: `prueba-${p.id}` }).execute();
    const row = ((await get(ctx.app, A(), { cookie: admin.cookie })).json() as AdminPopupList).popups.find((x) => x.id === p.id);
    expect(row?.counts).toEqual({ seen: 2, answered: 1, clicked: 1 });
  });
});
