import type { AdminMediaView, AdminNewsPost, AdminNewsView, Leaderboard, MissionsView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { NewsAdmin } from '../src/admin/NewsAdmin';
import { copy } from '../src/copy/es';
import { pickOption } from './pick';
import { jsonResponse, mockApi, renderAt } from './render';

// «Tablón» in the panel (the owner, 2026-11-14: «totalmente personalizable de forma intuitiva desde admin»): each
// section with its cards in order, moved up and down; the editor with the card as the players will see it, an image
// from the gallery or uploaded, and where it leads (a screen of the game or an https page); hiding, showing and
// deleting with a reason; the automatic cards are never deleted and their words are the game's.

afterEach(() => vi.unstubAllGlobals());
const t = copy.admin.news;
const b = copy.news.board;

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const ASSET = '00000000-0000-4000-8000-0000000000aa';
const post = (p: Partial<AdminNewsPost> & Pick<AdminNewsPost, 'id' | 'kind' | 'section'>): AdminNewsPost => ({
  title: '',
  body: '',
  image: null,
  link: null,
  featured: false,
  order: 0,
  startsAt: null,
  endsAt: null,
  updatedAt: '2026-11-14T10:00:00.000Z',
  hidden: false,
  live: true,
  by: null,
  ...p,
});
const view: AdminNewsView = {
  posts: [
    post({ id: id(1), kind: 'auto:discord', section: 'comunidad', featured: true, image: { kind: 'gallery', key: 'discord' }, link: { kind: 'url', href: 'https://discord.gg/2TA8RvKXv3', label: 'Unirme' } }),
    post({ id: id(2), kind: 'custom', section: 'comunidad', order: 1, title: 'Torneo del sábado', body: 'Apúntate en Clasificación', link: { kind: 'route', to: '/clasificacion', label: 'Ver el torneo' } }),
    post({ id: id(3), kind: 'custom', section: 'comunidad', order: 2, title: 'Mantenimiento', hidden: true, live: false }),
    post({ id: id(4), kind: 'auto:boosts', section: 'eventos' }),
  ],
};
const media: AdminMediaView = { assets: [{ id: ASSET, name: 'cartel.png', mime: 'image/png', bytes: 120_000, width: 960, height: 540, createdAt: '2026-11-14T10:00:00.000Z', uses: 0 }], totalBytes: 120_000 };
const board: Leaderboard = { season: null, tab: 'general', rows: [], me: null, total: 0 };
const missions: MissionsView = {
  daily: { period: 'd:2026-11-14', endsAt: '2026-11-15T00:00:00.000Z', missions: [] },
  weekly: { period: 'w:2026-W46', endsAt: '2026-11-16T00:00:00.000Z', missions: [] },
  season: null,
  events: [],
  achievements: [],
  ready: 0,
  cosmetics: { titles: [], frames: [], title: null, frame: null },
};

const routes = (extra: Record<string, (body: unknown) => Response> = {}) =>
  mockApi({
    'GET /galaxy/api/admin/news': () => jsonResponse(200, view),
    'GET /galaxy/api/admin/media': () => jsonResponse(200, media),
    'GET /galaxy/api/notes': () => jsonResponse(200, { notes: [] }),
    'GET /galaxy/api/missions': () => jsonResponse(200, missions),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board),
    'GET /galaxy/api/boosts': () => jsonResponse(200, { boosts: [], anomaly: null }),
    ...extra,
  });
const open = () => renderAt('/admin/tablon', { '/admin/tablon': <NewsAdmin /> });
const rows = (section: HTMLElement) => within(section).getAllByRole('listitem');

test('cada sección con sus tarjetas en orden, su estado y adónde llevan; las automáticas no se eliminan', async () => {
  routes();
  open();
  const community = await screen.findByRole('region', { name: b.sections.comunidad });
  const [discord, tournament, hidden] = rows(community);
  expect(discord).toHaveTextContent(b.discordTitle);
  expect(discord).toHaveTextContent(t.autoChip(t.kinds['auto:discord']));
  expect(discord).toHaveTextContent(t.featuredChip);
  expect(discord).toHaveTextContent('discord.gg/2TA8RvKXv3');
  expect(within(discord!).queryByRole('button', { name: `${t.actions.delete}: ${b.discordTitle}` })).toBeNull();
  expect(tournament).toHaveTextContent(t.states.live);
  expect(tournament).toHaveTextContent(t.routes['/clasificacion']);
  expect(within(tournament!).getByRole('button', { name: `${t.actions.delete}: Torneo del sábado` })).toBeInTheDocument();
  expect(hidden).toHaveTextContent(t.states.hidden);
  expect(within(hidden!).getByRole('button', { name: `${t.actions.show}: Mantenimiento` })).toBeInTheDocument();
  // An automatic card with nothing to say now (no multiplier on) says so.
  const events = screen.getByRole('region', { name: b.sections.eventos });
  expect(rows(events)[0]).toHaveTextContent(t.states.silent);
  // The first can't go up, the last can't go down.
  expect(within(discord!).getByRole('button', { name: t.up(b.discordTitle) })).toBeDisabled();
  expect(within(hidden!).getByRole('button', { name: t.down('Mantenimiento') })).toBeDisabled();
});

test('subir y bajar manda el orden nuevo de la sección', async () => {
  let sent: unknown = null;
  routes({
    'POST /galaxy/api/admin/news/order': (body) => {
      sent = body;
      return jsonResponse(200, { saved: true });
    },
  });
  const user = userEvent.setup();
  open();
  const community = await screen.findByRole('region', { name: b.sections.comunidad });
  await user.click(within(community).getByRole('button', { name: t.up('Torneo del sábado') }));
  await waitFor(() => expect(sent).toEqual({ section: 'comunidad', ids: [id(2), id(1), id(3)] }));
});

test('«Nueva tarjeta» la crea con su imagen de la galería y su enlace a una pantalla, y la enseña como la verán', async () => {
  let saved: unknown = null;
  routes({
    'POST /galaxy/api/admin/news': (body) => {
      saved = body;
      return jsonResponse(200, { id: id(9) });
    },
  });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.create }));
  const dialog = await screen.findByRole('dialog', { name: t.create });
  const preview = within(dialog).getByRole('region', { name: t.preview });
  const save = within(dialog).getByRole('button', { name: t.save });
  expect(save).toBeDisabled();
  await user.type(within(dialog).getByLabelText(t.fields.title), 'Llega el mercado');
  await user.type(within(dialog).getByLabelText(t.fields.body), 'Compra y vende galaxias');
  await user.click(within(dialog).getByRole('radio', { name: t.gallery.mercado }));
  await user.click(within(dialog).getByRole('radio', { name: t.linkKinds.route }));
  await pickOption(user, within(dialog).getByRole('combobox', { name: t.fields.route }), t.routes['/mercado']);
  await user.type(within(dialog).getByLabelText(t.fields.label), 'Ir al mercado');
  // The card as the players will see it, with its image and its button.
  const card = within(preview).getByRole('article', { name: 'Llega el mercado' });
  expect(card).toHaveTextContent('Compra y vende galaxias');
  expect(card).toHaveTextContent('Ir al mercado');
  expect(card.querySelector('img')).toHaveAttribute('src', expect.stringContaining('mercado'));
  expect(save).toBeDisabled();
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Anuncio del mercado');
  await user.click(save);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(saved).toEqual({
    section: 'comunidad',
    title: 'Llega el mercado',
    body: 'Compra y vende galaxias',
    image: { kind: 'gallery', key: 'mercado' },
    link: { kind: 'route', to: '/mercado', label: 'Ir al mercado' },
    featured: false,
    startsAt: null,
    endsAt: null,
    reason: 'Anuncio del mercado',
  });
});

test('una página de fuera solo con https, y una imagen subida se puede elegir', async () => {
  let saved: unknown = null;
  routes({
    [`PUT /galaxy/api/admin/news/${id(2)}`]: (body) => {
      saved = body;
      return jsonResponse(200, { saved: true });
    },
  });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.editOf('Torneo del sábado') }));
  const dialog = await screen.findByRole('dialog', { name: t.editTitle });
  await user.click(within(dialog).getByRole('radio', { name: t.linkKinds.url }));
  await user.type(within(dialog).getByLabelText(t.fields.url), 'http://example.com/torneo');
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Enlace al torneo');
  expect(within(dialog).getByText(t.need.url)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: t.save })).toBeDisabled();
  await user.clear(within(dialog).getByLabelText(t.fields.url));
  await user.type(within(dialog).getByLabelText(t.fields.url), 'https://example.com/torneo');
  await user.click(within(dialog).getByRole('radio', { name: 'cartel.png' }));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(saved).not.toBeNull());
  expect(saved).toMatchObject({ image: { kind: 'asset', id: ASSET }, link: { kind: 'url', href: 'https://example.com/torneo', label: 'Ver el torneo' }, reason: 'Enlace al torneo' });
});

test('una tarjeta automática no deja escribir su título: lo pone el juego', async () => {
  routes();
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.editOf(b.discordTitle) }));
  const dialog = await screen.findByRole('dialog', { name: t.editTitle });
  expect(dialog).toHaveTextContent(t.autoNote(t.kinds['auto:discord']));
  expect(within(dialog).queryByLabelText(t.fields.title)).toBeNull();
  expect(within(within(dialog).getByRole('region', { name: t.preview })).getByRole('article', { name: b.discordTitle })).toBeInTheDocument();
});

test('ocultar pide un motivo y lo manda', async () => {
  let sent: unknown = null;
  routes({
    [`POST /galaxy/api/admin/news/${id(2)}/hide`]: (body) => {
      sent = body;
      return jsonResponse(200, { saved: true });
    },
  });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: `${t.actions.hide}: Torneo del sábado` }));
  const dialog = await screen.findByRole('alertdialog', { name: t.confirmTitle.hide('Torneo del sábado') });
  const go = within(dialog).getByRole('button', { name: t.actions.hide });
  expect(go).toBeDisabled();
  await user.type(within(dialog).getByLabelText(t.fields.reason), 'Ya pasó');
  await user.click(go);
  await waitFor(() => expect(sent).toEqual({ reason: 'Ya pasó' }));
});

test('subir una imagen la manda en base64 y la deja elegida; una que no es imagen se rechaza aquí', async () => {
  let uploaded: { name: string; data: string } | null = null;
  routes({
    'POST /galaxy/api/admin/media': (body) => {
      uploaded = body as { name: string; data: string };
      return jsonResponse(200, { id: ASSET });
    },
  });
  const user = userEvent.setup({ applyAccept: false });
  open();
  await user.click(await screen.findByRole('button', { name: t.create }));
  const dialog = await screen.findByRole('dialog', { name: t.create });
  const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
  await user.upload(input, new File(['hola'], 'notas.txt', { type: 'text/plain' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(t.image.wrongType);
  await user.upload(input, new File([new Uint8Array([137, 80, 78, 71])], 'cartel.png', { type: 'image/png' }));
  await waitFor(() => expect(uploaded).not.toBeNull());
  expect(uploaded).toEqual({ name: 'cartel.png', data: 'iVBORw==' });
  await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'cartel.png' })).toBeChecked());
});
