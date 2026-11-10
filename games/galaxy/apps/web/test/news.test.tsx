import type { BoostsView, MeResponse, TitleNotice } from '@galaxy/shared';
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
const until = new Intl.DateTimeFormat('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ENDS));

function api(n: TitleNotice[] = notices, b: BoostsView = boosts) {
  return mockApi({
    'GET /galaxy/api/notices': () => jsonResponse(200, n),
    'GET /galaxy/api/boosts': () => jsonResponse(200, b),
    'GET /galaxy/api/mailbox': () => jsonResponse(200, { unread: 0, messages: [] }),
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
  expect(card).toHaveTextContent(t.until(until));
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

test('la pantalla de inicio ya no enseña los avisos ni los multiplicadores sueltos', async () => {
  api();
  renderAt('/', { '/': <TitleScreen me={me} /> });
  await screen.findByRole('button', { name: t.buttonLabel(3) });
  expect(screen.queryByText(LAUNCH)).toBeNull();
  expect(screen.queryByText('Lanzamiento de la Beta Abierta')).toBeNull();
});
