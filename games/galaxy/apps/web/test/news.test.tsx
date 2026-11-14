import type { BoostsView, Leaderboard, MeResponse, MissionsView, NewsPost, ReleaseNote, TitleNotice } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TitleScreen } from '../src/hub/TitleScreen';
import { TopBar } from '../src/hub/TopBar';
import { jsonResponse, mockApi, renderAt } from './render';

// Noticias (open beta; a board since the owner's ask of 2026-11-14): the team's notices, a carousel of the featured
// cards and each section's cards, behind a «Noticias» button next to Comunidad and Amigos that says how many things are
// new to this browser. The automatic cards say what the game has now (the latest notes, the events, the season and its
// anomaly, the multipliers, the Discord) and are not shown when they have nothing to say.
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const t = copy.news;
const b = t.board;
const me: MeResponse = { id: 'p1', username: 'vega', roles: [], mfa: false, level: 6 };
const LAUNCH = 'Arranca la Beta Abierta y la Temporada 1. Eventos activos hasta el 24 de noviembre';
const notices: TitleNotice[] = [
  { id: 'n1', text: LAUNCH, tone: 'info' },
  { id: 'n2', text: 'Mantenimiento el domingo a las 10', tone: 'warning' },
];
const ENDS = '2026-11-16T23:00:00.000Z';
const boosts: BoostsView = {
  boosts: [
    { id: 'b1', name: 'Lanzamiento de la Beta Abierta', currency: 'coins', factor: 1.5, endsAt: ENDS },
    { id: 'b2', name: 'Lanzamiento de la Beta Abierta', currency: 'dust', factor: 1.5, endsAt: ENDS },
  ],
  anomaly: null,
};
const anomaly = { id: 'contagion', name: 'Corrosión contagiosa', description: 'Un enemigo corroído que cae corroe a los que tiene cerca' };
const SEASON_END = '2026-12-07T23:00:00.000Z';
const board: Leaderboard = {
  season: { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-09T23:00:00.000Z', endsAt: SEASON_END, tiers: [350, 1400, 4200, 10000, 20000] },
  tab: 'general',
  rows: [],
  me: null,
  total: 0,
};
const note: ReleaseNote = { id: 'v1-26-tablon', version: '1.26', date: '2026-11-14', title: 'Un tablón de noticias', summary: 'Las noticias pasan a ser un tablón con imágenes', items: [{ kind: 'nuevo', text: 'El tablón' }] };
const noMissions: MissionsView = {
  daily: { period: 'd:2026-11-14', endsAt: ENDS, missions: [] },
  weekly: { period: 'w:2026-W46', endsAt: ENDS, missions: [] },
  season: null,
  events: [],
  achievements: [],
  ready: 0,
  cosmetics: { titles: [], frames: [], title: null, frame: null },
};
const missions: MissionsView = { ...noMissions, events: [{ id: 'cosecha', name: 'Cosecha estelar', description: 'Doble de polvo en los sectores de hielo', endsAt: ENDS, period: 'e:cosecha', goals: [], inClan: false }] };

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const post = (p: Partial<NewsPost> & Pick<NewsPost, 'id' | 'kind' | 'section'>): NewsPost => ({ title: '', body: '', image: null, link: null, featured: false, order: 0, startsAt: null, endsAt: null, updatedAt: '2026-11-14T10:00:00.000Z', ...p });
const DISCORD = 'https://discord.gg/2TA8RvKXv3';
const posts: NewsPost[] = [
  post({ id: id(1), kind: 'auto:discord', section: 'comunidad', featured: true, image: { kind: 'gallery', key: 'discord' }, link: { kind: 'url', href: DISCORD, label: 'Unirme' } }),
  post({ id: id(2), kind: 'auto:season', section: 'comunidad', order: 1 }),
  post({ id: id(3), kind: 'auto:events', section: 'eventos', featured: true }),
  post({ id: id(4), kind: 'auto:boosts', section: 'eventos', order: 1 }),
  post({ id: id(5), kind: 'auto:patch', section: 'novedades' }),
  post({ id: id(6), kind: 'custom', section: 'novedades', order: 1, title: 'Llega el mercado de trueques', body: 'Cambia galaxias con otros jugadores', link: { kind: 'route', to: '/mercado', label: 'Ir al mercado' } }),
];

function api({ n = notices, bv = boosts, p = posts, events = missions }: { n?: TitleNotice[]; bv?: BoostsView; p?: NewsPost[]; events?: MissionsView } = {}) {
  return mockApi({
    'GET /galaxy/api/notices': () => jsonResponse(200, n),
    'GET /galaxy/api/boosts': () => jsonResponse(200, bv),
    'GET /galaxy/api/news': () => jsonResponse(200, { posts: p }),
    'GET /galaxy/api/notes': () => jsonResponse(200, { notes: [note] }),
    'GET /galaxy/api/missions': () => jsonResponse(200, events),
    'GET /galaxy/api/mailbox': () => jsonResponse(200, { unread: 0, messages: [] }),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board),
  });
}
const bar = () => <TopBar me={me} wallet={{ coins: 10, dust: 2, signal: 1 }} freePull={false} onLogout={() => {}} leaving={false} />;
// The two notices and the six cards (every automatic one has something to say).
const ALL = 8;

test('Noticias va junto a Comunidad y Amigos y cuenta lo que hay sin ver: los avisos y cada tarjeta del tablón', async () => {
  api();
  renderAt('/', { '/': bar() });
  const news = await screen.findByRole('button', { name: t.buttonLabel(ALL) });
  const nav = screen.getByRole('navigation', { name: copy.hub.shortcuts });
  expect(nav).toContainElement(news);
  expect(news.previousElementSibling).toBe(screen.getByRole('button', { name: copy.friends.buttonLabel(0, 0) }));
  expect(news).toHaveTextContent(t.button);
});

// The owner: a button to join the game's Discord community, right next to Noticias, opening in a new tab.
test('al lado de Noticias, el botón de Discord lleva a la comunidad en otra pestaña', async () => {
  api();
  renderAt('/', { '/': bar() });
  const news = await screen.findByRole('button', { name: t.buttonLabel(ALL) });
  const discord = screen.getByRole('link', { name: copy.hub.discordLabel });
  expect(news.nextElementSibling).toBe(discord);
  expect(discord).toHaveAttribute('href', DISCORD);
  expect(discord).toHaveAttribute('target', '_blank');
  expect(discord).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('el tablón: los avisos arriba, las destacadas en un carrusel y cada sección con sus tarjetas; lo visto deja de contar', async () => {
  api();
  const { unmount } = renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(ALL) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  const avisos = within(dialog).getByRole('region', { name: t.notices });
  expect(avisos).toHaveTextContent(LAUNCH);
  expect(within(avisos).getByText('Mantenimiento el domingo a las 10').closest('li')).toHaveTextContent(t.important);
  expect(within(avisos).getAllByText(t.fresh)).toHaveLength(2);

  // The carousel: the Discord first (its link opens outside), then the event on.
  const hero = within(dialog).getByRole('region', { name: b.featured });
  const discord = within(hero).getByRole('article', { name: b.discordTitle });
  expect(discord).toHaveTextContent(t.fresh);
  const join = within(discord).getByRole('link', { name: `Unirme. ${b.opensOutside}` });
  expect(join).toHaveAttribute('href', DISCORD);
  expect(join).toHaveAttribute('target', '_blank');
  expect(join).toHaveAttribute('rel', expect.stringContaining('noopener'));
  // Its image: the game's own Discord art.
  expect(discord.querySelector('img')).toHaveAttribute('src', expect.stringContaining('discord'));
  expect(within(hero).getByRole('button', { name: b.goTo(1, 2) })).toHaveAttribute('aria-current', 'true');
  await userEvent.click(within(hero).getByRole('button', { name: b.next }));
  const event = within(hero).getByRole('article', { name: 'Cosecha estelar' });
  expect(event).toHaveTextContent('Doble de polvo en los sectores de hielo');
  expect(event).toHaveTextContent(/Hasta el (lunes|martes) 1[67] de noviembre a las \d{2}:\d{2}/);
  expect(within(hero).getByRole('button', { name: b.goTo(2, 2) })).toHaveAttribute('aria-current', 'true');

  // The sections, without the featured cards (they are in the carousel).
  const community = within(dialog).getByRole('region', { name: b.sections.comunidad });
  expect(within(community).queryByRole('article', { name: b.discordTitle })).toBeNull();
  const season = within(community).getByRole('article', { name: 'Temporada 1' });
  expect(season).toHaveTextContent(/Termina el \d{1,2} de diciembre/);
  const events = within(dialog).getByRole('region', { name: b.sections.eventos });
  const multipliers = within(events).getByRole('article', { name: b.boostsTitle });
  // The two multipliers of the same launch go on one line.
  expect(multipliers).toHaveTextContent(`Lanzamiento de la Beta Abierta: ${t.rate('coins', 1.5)}, ${t.rate('dust', 1.5)}`);
  const latest = within(dialog).getByRole('region', { name: b.sections.novedades });
  const patch = within(latest).getByRole('article', { name: note.title });
  expect(patch).toHaveTextContent('v1.26');
  expect(within(patch).getByRole('link', { name: b.readNotes })).toHaveAttribute('href', '/notas-de-version?version=1.26');
  expect(within(latest).getByRole('link', { name: 'Ir al mercado' })).toHaveAttribute('href', '/mercado');

  await userEvent.click(within(dialog).getByRole('button', { name: t.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: t.buttonLabel(0) })).toBeInTheDocument();
  unmount();
  vi.unstubAllGlobals();
  // Seen stays seen in this browser; a new notice and a corrected card count again.
  api({ n: [...notices, { id: 'n3', text: 'Nuevo evento el viernes', tone: 'info' }], p: posts.map((x) => (x.kind === 'custom' ? { ...x, updatedAt: '2026-11-15T09:00:00.000Z' } : x)) });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(2) }));
  const again = await screen.findByRole('dialog', { name: t.title });
  expect(within(again).getAllByText(t.fresh)).toHaveLength(2);
  expect(within(again).getByText('Nuevo evento el viernes').closest('li')).toHaveTextContent(t.fresh);
  expect(within(again).getByRole('article', { name: 'Llega el mercado de trueques' })).toHaveTextContent(t.fresh);
});

test('una tarjeta que lleva a una pantalla del juego navega allí y cierra el tablón', async () => {
  api();
  renderAt('/', { '/': bar(), '/mercado': <p>La pantalla del mercado</p> });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(ALL) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await userEvent.click(within(dialog).getByRole('link', { name: 'Ir al mercado' }));
  expect(await screen.findByText('La pantalla del mercado')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('las tarjetas automáticas sin nada que contar no salen; sin nada más, el tablón dice que no hay noticias', async () => {
  const fetch = api({ n: [], bv: { boosts: [], anomaly: null }, p: posts.filter((x) => x.kind === 'auto:boosts' || x.kind === 'auto:events'), events: noMissions });
  renderAt('/', { '/': bar() });
  await vi.waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/news')).toBe(true));
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(0) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  expect(dialog).toHaveTextContent(t.empty);
  expect(within(dialog).queryByRole('article')).toBeNull();
});

test('la pantalla de inicio ya no enseña los avisos, los multiplicadores ni la anomalía sueltos', async () => {
  api({ bv: { ...boosts, anomaly } });
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByRole('button', { name: t.buttonLabel(ALL) });
  // The season column is there (its leaderboard answered), without the anomaly's tag.
  expect(await screen.findByText('Temporada 1')).toBeInTheDocument();
  expect(screen.queryByText(LAUNCH)).toBeNull();
  expect(screen.queryByText('Lanzamiento de la Beta Abierta')).toBeNull();
  expect(screen.queryByText(new RegExp(anomaly.name))).toBeNull();
});

test('la anomalía de temporada va en la tarjeta de la temporada: cuenta como nueva una vez y dice lo que hace', async () => {
  api({ n: [], bv: { boosts: [], anomaly }, p: posts.filter((x) => x.kind === 'auto:season') });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(1) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  const season = within(dialog).getByRole('article', { name: 'Temporada 1' });
  expect(season).toHaveTextContent(b.anomaly(anomaly.name));
  expect(season).toHaveTextContent(anomaly.description);
  expect(season).toHaveTextContent(t.fresh);
  await userEvent.click(within(dialog).getByRole('button', { name: t.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: t.buttonLabel(0) })).toBeInTheDocument();
});
