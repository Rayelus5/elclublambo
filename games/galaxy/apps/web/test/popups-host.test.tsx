import type { GachaView, PopupView, TutorialView } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { POPUP_SESSION_KEY, PopupHost } from '../src/popups/PopupHost';
import { resetPrefs, setPrefs } from '../src/settings/prefs';
import { jsonResponse, mockApi, renderAt } from './render';

// «Encuestas y avisos» (plan 2026-11-22, part A): the title screen opens a campaign's popup only when nothing else
// asks for the player (the guided tour, the event leftovers, another dialog, the entrance), once per app open; it says
// the popup was shown once, and Escape is «Más tarde».

const ID = '11111111-1111-4111-8111-111111111111';
const PROMPT = '¿Recomendarías Galaxy Survivor a un amigo?';
const survey: PopupView = {
  id: ID,
  kind: 'survey',
  title: 'Tu opinión cuenta',
  body: '',
  image: null,
  link: null,
  questions: [{ type: 'scale', id: 'rec', prompt: PROMPT, range: '1-5', low: 'Poco probable', high: 'Muy probable', subject: null }],
  reward: [],
};
const done: TutorialView = { status: 'done', chapter: 'done', gift: 0 };
const active: TutorialView = { status: 'active', chapter: 'hub', gift: 0 };
const gacha = (leftovers: GachaView['leftovers'] = []): GachaView => ({
  banners: [],
  costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 1250, dust: 40, signal: 10 },
  leftovers,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function api({ tutorial = done, leftovers = [] as GachaView['leftovers'], popup = survey as PopupView | null } = {}) {
  return mockApi({
    'GET /galaxy/api/tutorial': () => jsonResponse(200, tutorial),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(leftovers)),
    'GET /galaxy/api/popups/next': () => jsonResponse(200, { popup }),
    [`POST /galaxy/api/popups/${ID}/shown`]: () => jsonResponse(204),
    [`POST /galaxy/api/popups/${ID}/later`]: () => jsonResponse(204),
  });
}
const calls = (fetch: ReturnType<typeof api>, path: string, method = 'GET') =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api${path}` && (init?.method ?? 'GET') === method).length;

beforeEach(() => {
  sessionStorage.clear();
  // No entrance to wait for (the timer is checked in its own test).
  setPrefs({ motion: 'reduced' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetPrefs();
});

test('mientras el tutorial guiado está activo no pide ninguna campaña', async () => {
  const fetch = api({ tutorial: active });
  renderAt('/', { '/': <PopupHost /> });
  await waitFor(() => expect(calls(fetch, '/tutorial')).toBe(1));
  await waitFor(() => expect(calls(fetch, '/gacha')).toBe(1));
  await wait(450);
  expect(calls(fetch, '/popups/next')).toBe(0);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('con señales de evento sobrantes por avisar no pide ninguna campaña', async () => {
  const fetch = api({ leftovers: [{ id: '7', label: 'Lluvia de estrellas', signals: 12, dust: 240 }] });
  renderAt('/', { '/': <PopupHost /> });
  await waitFor(() => expect(calls(fetch, '/gacha')).toBe(1));
  await wait(450);
  expect(calls(fetch, '/popups/next')).toBe(0);
});

test('con otro diálogo abierto espera a que se cierre', async () => {
  const other = document.createElement('div');
  other.setAttribute('role', 'dialog');
  document.body.append(other);
  const fetch = api();
  renderAt('/', { '/': <PopupHost /> });
  await waitFor(() => expect(calls(fetch, '/gacha')).toBe(1));
  await wait(450);
  expect(calls(fetch, '/popups/next')).toBe(0);
  other.remove();
  expect(await screen.findByRole('dialog', { name: survey.title })).toBeInTheDocument();
});

test('espera a que termine la entrada del inicio', async () => {
  setPrefs({ motion: 'full' });
  const fetch = api();
  renderAt('/', { '/': <PopupHost /> });
  await waitFor(() => expect(calls(fetch, '/gacha')).toBe(1));
  await wait(300);
  expect(calls(fetch, '/popups/next')).toBe(0);
  await waitFor(() => expect(calls(fetch, '/popups/next')).toBe(1), { timeout: 2500 });
});

test('abre la campaña una vez: marca la sesión, avisa de que se vio una sola vez y otro inicio ya no pide nada', async () => {
  const fetch = api();
  const first = renderAt('/', { '/': <PopupHost /> });
  const dialog = await screen.findByRole('dialog', { name: survey.title });
  expect(sessionStorage.getItem(POPUP_SESSION_KEY)).toBe('1');
  await waitFor(() => expect(calls(fetch, `/popups/${ID}/shown`, 'POST')).toBe(1));
  // The focus starts in the scale.
  const group = within(dialog).getByRole('radiogroup', { name: PROMPT });
  expect(group).toContainElement(document.activeElement as HTMLElement);
  first.unmount();
  renderAt('/', { '/': <PopupHost /> });
  await wait(450);
  expect(calls(fetch, '/popups/next')).toBe(1);
  expect(calls(fetch, `/popups/${ID}/shown`, 'POST')).toBe(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('sin campaña no marca la sesión: el siguiente inicio vuelve a preguntar', async () => {
  const fetch = api({ popup: null });
  const first = renderAt('/', { '/': <PopupHost /> });
  await waitFor(() => expect(calls(fetch, '/popups/next')).toBe(1));
  await wait(50);
  expect(sessionStorage.getItem(POPUP_SESSION_KEY)).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  first.unmount();
  renderAt('/', { '/': <PopupHost /> });
  await waitFor(() => expect(calls(fetch, '/popups/next')).toBe(2));
});

test('Escape es «Más tarde»: lo dice al servidor y cierra', async () => {
  const fetch = api();
  renderAt('/', { '/': <PopupHost /> });
  const dialog = await screen.findByRole('dialog', { name: survey.title });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(calls(fetch, `/popups/${ID}/later`, 'POST')).toBe(1));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('«Más tarde» también cierra y lo cuenta', async () => {
  const fetch = api();
  renderAt('/', { '/': <PopupHost /> });
  const dialog = await screen.findByRole('dialog', { name: survey.title });
  fireEvent.click(within(dialog).getByRole('button', { name: copy.popups.later }));
  await waitFor(() => expect(calls(fetch, `/popups/${ID}/later`, 'POST')).toBe(1));
  expect(screen.queryByRole('dialog')).toBeNull();
});
