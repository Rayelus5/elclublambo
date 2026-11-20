import { type AdminMediaView, type AdminNewsView, type NewsView, type Role } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAdminViaCli, fixedConfig, get, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The news board (the owner, 2026-11-14): everyone reads the cards on now; the admin creates, edits, orders, hides
// and deletes custom cards, places the auto ones (never deleted), and uploads images checked by their own bytes,
// served from the same origin and kept while a card uses them. Every change is audited.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
});
afterAll(() => ctx.close());

async function staff(role: Role) {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  return { cookie: sessionCookie(res), username };
}
let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
});

const A = (path: string) => `/galaxy/api/admin${path}`;
const reason = 'Prueba del tablón';
const card = (over: object = {}) => ({
  section: 'destacado',
  title: 'Primer torneo',
  body: 'Juega, gana señales y skins',
  image: { kind: 'gallery', key: 'torneo' },
  link: { kind: 'route', to: '/misiones', label: 'Ver las metas' },
  featured: true,
  startsAt: null,
  endsAt: null,
  reason,
  ...over,
});
const board = async () => (await get(ctx.app, '/galaxy/api/news')).json() as NewsView;
const panel = async () => (await get(ctx.app, A('/news'), { cookie: admin.cookie })).json() as AdminNewsView;
const audits = (id: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action']).where('target_id', '=', id).orderBy('id').execute();

/** A real 2×1 PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGGAMAEH5Af/YT4MIAAAAAElFTkSuQmCC';

describe('el tablón', () => {
  test('trae las tarjetas automáticas de serie, y un jugador no entra en el panel', async () => {
    const kinds = (await board()).posts.map((p) => p.kind);
    for (const k of ['auto:discord', 'auto:season', 'auto:events', 'auto:boosts', 'auto:patch']) expect(kinds).toContain(k);
    const p = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('nws'), password: 'una-clave-larga' });
    expect((await get(ctx.app, A('/news'), { cookie: sessionCookie(p) })).statusCode).toBe(403);
    expect((await post(ctx.app, A('/news'), card(), { cookie: sessionCookie(p) })).statusCode).toBe(403);
  });

  test('crear, editar, ocultar y borrar una tarjeta propia, con auditoría', async () => {
    const res = await post(ctx.app, A('/news'), card(), { cookie: admin.cookie });
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };
    expect((await board()).posts.find((p) => p.id === id)).toMatchObject({ kind: 'custom', title: 'Primer torneo', link: { kind: 'route', to: '/misiones' } });
    expect((await put(ctx.app, A(`/news/${id}`), card({ title: 'Primer torneo, última semana' }), { cookie: admin.cookie })).statusCode).toBe(200);
    expect((await board()).posts.find((p) => p.id === id)!.title).toBe('Primer torneo, última semana');
    await post(ctx.app, A(`/news/${id}/hide`), { reason }, { cookie: admin.cookie });
    expect((await board()).posts.some((p) => p.id === id)).toBe(false);
    expect((await panel()).posts.find((p) => p.id === id)).toMatchObject({ hidden: true, live: false, by: admin.username });
    expect((await post(ctx.app, A(`/news/${id}/delete`), { reason }, { cookie: admin.cookie })).statusCode).toBe(200);
    expect((await panel()).posts.some((p) => p.id === id)).toBe(false);
    expect((await audits(id)).map((a) => a.action)).toEqual(['news.create', 'news.save', 'news.hide', 'news.delete']);
  });

  test('las fechas deciden cuándo se ve, y un enlace de fuera solo puede ser https', async () => {
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const { id } = (await post(ctx.app, A('/news'), card({ startsAt: later }), { cookie: admin.cookie })).json() as { id: string };
    expect((await board()).posts.some((p) => p.id === id)).toBe(false);
    expect((await panel()).posts.find((p) => p.id === id)!.live).toBe(false);
    expect((await post(ctx.app, A('/news'), card({ link: { kind: 'url', href: 'http://evil.example', label: 'Ir' } }), { cookie: admin.cookie })).statusCode).toBe(400);
    expect((await post(ctx.app, A('/news'), card({ link: { kind: 'route', to: '/admin', label: 'Ir' } }), { cookie: admin.cookie })).statusCode).toBe(400);
  });

  test('una automática no se borra (se oculta), guarda su tipo y no toma título', async () => {
    const auto = (await panel()).posts.find((p) => p.kind === 'auto:patch')!;
    expect((await post(ctx.app, A(`/news/${auto.id}/delete`), { reason }, { cookie: admin.cookie })).json()).toMatchObject({ error: 'news_auto' });
    await put(ctx.app, A(`/news/${auto.id}`), card({ section: 'novedades', title: 'No vale', image: { kind: 'gallery', key: 'notas' } }), { cookie: admin.cookie });
    expect((await panel()).posts.find((p) => p.id === auto.id)).toMatchObject({ kind: 'auto:patch', title: '' });
  });

  test('ordenar una sección', async () => {
    const a = ((await post(ctx.app, A('/news'), card({ section: 'novedades', title: 'A' }), { cookie: admin.cookie })).json() as { id: string }).id;
    const b = ((await post(ctx.app, A('/news'), card({ section: 'novedades', title: 'B' }), { cookie: admin.cookie })).json() as { id: string }).id;
    expect((await post(ctx.app, A('/news/order'), { section: 'novedades', ids: [b, a] }, { cookie: admin.cookie })).statusCode).toBe(200);
    const novedades = (await panel()).posts.filter((p) => p.section === 'novedades').map((p) => p.id);
    expect(novedades.indexOf(b)).toBeLessThan(novedades.indexOf(a));
    // A card of another section is not this one's to order.
    const other = (await panel()).posts.find((p) => p.section === 'comunidad')!.id;
    expect((await post(ctx.app, A('/news/order'), { section: 'novedades', ids: [other] }, { cookie: admin.cookie })).statusCode).toBe(400);
  });
});

describe('las imágenes', () => {
  test('una imagen subida se comprueba, se sirve con caché y se reutiliza si es la misma', async () => {
    const res = await post(ctx.app, A('/media'), { name: 'torneo.png', data: PNG }, { cookie: admin.cookie });
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };
    expect(((await post(ctx.app, A('/media'), { name: 'otra.png', data: PNG }, { cookie: admin.cookie })).json() as { id: string }).id).toBe(id);
    const file = await get(ctx.app, `/galaxy/api/media/${id}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toContain('immutable');
    expect(file.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    const media = (await get(ctx.app, A('/media'), { cookie: admin.cookie })).json() as AdminMediaView;
    expect(media.assets.find((m) => m.id === id)).toMatchObject({ mime: 'image/png', width: 2, height: 1, uses: 0 });
  });

  test('lo que no es una imagen se rechaza', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').toString('base64');
    expect((await post(ctx.app, A('/media'), { name: 'x.png', data: svg }, { cookie: admin.cookie })).json()).toMatchObject({ error: 'media_invalid' });
  });

  test('una imagen usada por una tarjeta no se borra; sin uso, sí', async () => {
    const png = Buffer.from(PNG, 'base64');
    // A different image (one more byte after IEND is still a PNG by its header).
    const other = Buffer.concat([png, Buffer.from([0])]).toString('base64');
    const { id: asset } = (await post(ctx.app, A('/media'), { name: 'b.png', data: other }, { cookie: admin.cookie })).json() as { id: string };
    const { id: news } = (await post(ctx.app, A('/news'), card({ image: { kind: 'asset', id: asset } }), { cookie: admin.cookie })).json() as { id: string };
    expect((await post(ctx.app, A(`/media/${asset}/delete`), { reason }, { cookie: admin.cookie })).json()).toMatchObject({ error: 'media_in_use' });
    await post(ctx.app, A(`/news/${news}/delete`), { reason }, { cookie: admin.cookie });
    expect((await post(ctx.app, A(`/media/${asset}/delete`), { reason }, { cookie: admin.cookie })).statusCode).toBe(200);
    expect((await get(ctx.app, `/galaxy/api/media/${asset}`)).statusCode).toBe(404);
    // A card cannot name an image there is not.
    expect((await post(ctx.app, A('/news'), card({ image: { kind: 'asset', id: asset } }), { cookie: admin.cookie })).json()).toMatchObject({ error: 'media_not_found' });
  });
});
