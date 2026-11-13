import type { BoostsView, Leaderboard, MeResponse, TitleNotice } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { TitleScreen } from '../src/hub/TitleScreen';
import { TopBar } from '../src/hub/TopBar';
import { jsonResponse, mockApi, renderAt } from './render';

// Noticias (open beta): the title notices and the running multipliers no longer sit on the home screen; they wait
// behind a «Noticias» button next to Comunidad and Amigos, which says how many are new and opens them in a window.
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const t = copy.news;
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

function api(n: TitleNotice[] = notices, b: BoostsView = boosts) {
  return mockApi({
    'GET /galaxy/api/notices': () => jsonResponse(200, n),
    'GET /galaxy/api/boosts': () => jsonResponse(200, b),
    'GET /galaxy/api/mailbox': () => jsonResponse(200, { unread: 0, messages: [] }),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, board),
  });
}
const bar = () => <TopBar me={me} wallet={{ coins: 10, dust: 2, signal: 1 }} freePull={false} onLogout={() => {}} leaving={false} />;

test('Noticias va junto a Comunidad y Amigos y dice cuántas hay sin ver (los dos multiplicadores del mismo lanzamiento cuentan como una)', async () => {
  api();
  renderAt('/', { '/': bar() });
  const news = await screen.findByRole('button', { name: t.buttonLabel(3) });
  const nav = screen.getByRole('navigation', { name: copy.hub.shortcuts });
  expect(nav).toContainElement(news);
  expect(news.previousElementSibling).toBe(screen.getByRole('button', { name: copy.friends.buttonLabel(0, 0) }));
  expect(news).toHaveTextContent(t.button);
});

// The owner: a button to join the game's Discord community, right next to Noticias, opening in a new tab.
test('al lado de Noticias, el botón de Discord lleva a la comunidad en otra pestaña', async () => {
  api();
  renderAt('/', { '/': bar() });
  const news = await screen.findByRole('button', { name: t.buttonLabel(3) });
  const discord = screen.getByRole('link', { name: copy.hub.discordLabel });
  expect(news.nextElementSibling).toBe(discord);
  expect(discord).toHaveAttribute('href', 'https://discord.gg/2TA8RvKXv3');
  expect(discord).toHaveAttribute('target', '_blank');
  expect(discord).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(discord).toHaveTextContent(copy.hub.discord);
});

test('Noticias abre una ventana con los avisos y los multiplicadores en marcha, y lo visto deja de contar como nuevo', async () => {
  api();
  const { unmount } = renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(3) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  const avisos = within(dialog).getByRole('region', { name: t.notices });
  expect(avisos).toHaveTextContent(LAUNCH);
  expect(within(avisos).getByText('Mantenimiento el domingo a las 10').closest('li')).toHaveTextContent(t.important);
  expect(within(avisos).getAllByText(t.fresh)).toHaveLength(2);
  const multipliers = within(dialog).getByRole('region', { name: t.boosts });
  const card = within(multipliers).getByText('Lanzamiento de la Beta Abierta').closest('li')!;
  expect(card).toHaveTextContent(t.rate('coins', 1.5));
  expect(card).toHaveTextContent(t.rate('dust', 1.5));
  // The end says the day's number and month, not only the weekday (in UTC on CI: Monday the 16th at 23:00).
  expect(card).toHaveTextContent(/Hasta el (lunes|martes) 1[67] de noviembre a las \d{2}:\d{2}/);
  await userEvent.click(within(dialog).getByRole('button', { name: t.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: t.buttonLabel(0) })).toBeInTheDocument();
  unmount();
  vi.unstubAllGlobals();
  // Seen stays seen in this browser; a new notice counts again.
  api([...notices, { id: 'n3', text: 'Nuevo evento el viernes', tone: 'info' }]);
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(1) }));
  const again = await screen.findByRole('dialog', { name: t.title });
  expect(within(again).getAllByText(t.fresh)).toHaveLength(1);
  expect(within(again).getByText('Nuevo evento el viernes').closest('li')).toHaveTextContent(t.fresh);
});

test('sin avisos ni multiplicadores Noticias no marca nada y su ventana dice que no hay noticias ahora mismo', async () => {
  const fetch = api([], { boosts: [], anomaly: null });
  renderAt('/', { '/': bar() });
  await vi.waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/notices')).toBe(true));
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(0) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  expect(dialog).toHaveTextContent(t.empty);
  expect(within(dialog).queryByRole('region')).toBeNull();
});

test('la pantalla de inicio ya no enseña los avisos, los multiplicadores ni la anomalía sueltos', async () => {
  api(notices, { ...boosts, anomaly });
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByRole('button', { name: t.buttonLabel(4) });
  // The season column is there (its leaderboard answered), without the anomaly's tag.
  expect(await screen.findByText('Temporada 1')).toBeInTheDocument();
  expect(screen.queryByText(LAUNCH)).toBeNull();
  expect(screen.queryByText('Lanzamiento de la Beta Abierta')).toBeNull();
  expect(screen.queryByText(new RegExp(anomaly.name))).toBeNull();
});

test('la anomalía de temporada también está en Noticias: cuenta como nueva una vez y su tarjeta dice lo que hace y hasta cuándo', async () => {
  api([], { boosts: [], anomaly });
  renderAt('/', { '/': bar() });
  await userEvent.click(await screen.findByRole('button', { name: t.buttonLabel(1) }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  const season = within(dialog).getByRole('region', { name: t.anomaly });
  expect(season).toHaveTextContent(anomaly.name);
  expect(season).toHaveTextContent(anomaly.description);
  expect(season).toHaveTextContent(t.fresh);
  expect(await within(season).findByText(/^Activa hasta el \d{1,2} de diciembre$/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: t.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: t.buttonLabel(0) })).toBeInTheDocument();
});
