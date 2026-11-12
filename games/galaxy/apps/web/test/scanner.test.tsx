import type { GachaView, PulledGalaxy, PullResponse, Tier } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ScannerScreen } from '../src/scanner/ScannerScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The deep scan screen (GDD §9): what the next scan can give and how far the guarantee is, BEFORE paying; paying with
// signals, coins or the daily free scan; then the reveal, which Saltar cuts short to the summary.
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
afterEach(() => vi.unstubAllGlobals());

const view = (over: Partial<GachaView> = {}): GachaView => ({
  banners: [
    {
      id: 'deep-scan',
      kind: 'standard',
      name: 'Escáner profundo',
      currency: 'signal',
      nextRates: [0.5, 0.28, 0.13, 0.06, 0.03],
      sinceLegendary: 3,
      untilGuarantee: 7,
      welcome: true,
    },
  ],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 250, dust: 0, signal: 10 },
  ...over,
});
const pulled = (i: number, tier: Tier = 'common'): PulledGalaxy => ({
  id: `n${i}`,
  seed: String(700 + i),
  tier,
  finish: 'normal',
  traits: { galaxy_type: 'spiral', palette: 'solar_gold', phenomenon: 'none' },
  name: `Nueva ${i}`,
  designation: `GX-00000${i}`,
  featured: false,
});

test('antes de tirar se ven las probabilidades de cada rareza y cuánto falta para la garantía', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view()) });
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  const odds = await screen.findByRole('table', { name: copy.scanner.odds });
  expect(within(odds).getByRole('row', { name: new RegExp(`${copy.tiers.legendary}.*${copy.scanner.rate(0.03)}`) })).toBeInTheDocument();
  expect(within(odds).getByRole('row', { name: new RegExp(`${copy.tiers.common}.*${copy.scanner.rate(0.5)}`) })).toBeInTheDocument();
  expect(screen.getByText(copy.scanner.untilGuarantee(7))).toBeInTheDocument();
  expect(screen.getByText(copy.scanner.welcome)).toBeInTheDocument();
});

test('escanear 10 con señales pide una vez con su clave, revela y Saltar lleva al resumen', async () => {
  const response: PullResponse = {
    pulls: Array.from({ length: 10 }, (_, i) => pulled(i, i === 9 ? 'legendary' : 'common')),
    wallet: { coins: 250, dust: 0, signal: 0 },
    view: view({ wallet: { coins: 250, dust: 0, signal: 0 } }),
  };
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, response),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  expect(within(stage).getByText(copy.scanner.progress(1, 10))).toBeInTheDocument();
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  expect(await within(stage).findByRole('heading', { name: copy.scanner.summaryTitle(10) })).toBeInTheDocument();
  expect(within(stage).getAllByRole('article')).toHaveLength(10);
  // The rarest first in the summary.
  expect(within(stage).getAllByRole('article')[0]).toHaveAccessibleName('Nueva 9');
  const post = fetch.mock.calls.find(([url]) => url === '/galaxy/api/gacha/pull')!;
  expect(JSON.parse(String(post[1]?.body))).toEqual({ banner: 'deep-scan', count: 10, pay: 'signal' });
  expect((post[1]?.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  await user.click(within(stage).getByRole('button', { name: copy.scanner.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText(copy.hub.resource.signal(0))).toBeInTheDocument();
});

test('Espacio avanza el revelado (a la carta de la tirada), sin saltar al resumen', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, { pulls: [pulled(0, 'rare'), pulled(1)], wallet: { coins: 250, dust: 0, signal: 0 }, view: view() }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  expect(within(stage).queryByRole('article')).not.toBeInTheDocument();
  fireEvent.keyDown(window, { code: 'Space', key: ' ' });
  expect(await within(stage).findByRole('article')).toHaveAccessibleName('Nueva 0');
  expect(within(stage).queryByRole('heading', { name: copy.scanner.summaryTitle(2) })).not.toBeInTheDocument();
});

test('sin saldo los pagos se bloquean y el escaneo gratis aparece cuando toca', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view({ freePullAvailable: true, wallet: { coins: 50, dust: 0, signal: 0 } })),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, { pulls: [pulled(1)], wallet: { coins: 50, dust: 0, signal: 0 }, view: view() }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await screen.findByRole('table', { name: copy.scanner.odds });
  for (const name of [
    new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`),
    new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}`),
    new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costCoins(100)}`),
    new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costCoins(900)}`),
  ]) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
  }
  await user.click(screen.getByRole('button', { name: new RegExp(copy.scanner.free) }));
  await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  const post = fetch.mock.calls.find(([url]) => url === '/galaxy/api/gacha/pull')!;
  expect(JSON.parse(String(post[1]?.body))).toEqual({ banner: 'deep-scan', count: 1, pay: 'free' });
});

test('un error del servidor se dice con su texto', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view({ freePullAvailable: true })),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(409, { error: 'free_pull_used' }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(copy.scanner.free) }));
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.free_pull_used);
});

test('si se pierde la respuesta, reintentar usa la misma clave y no cobra dos veces (revisión final)', async () => {
  let posts = 0;
  const response: PullResponse = { pulls: [pulled(1)], wallet: { coins: 250, dust: 0, signal: 9 }, view: view({ wallet: { coins: 250, dust: 0, signal: 9 } }) };
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => {
      // The first answer never arrives (the server may well have charged it); the retry gets it.
      if (++posts === 1) throw new TypeError('Failed to fetch');
      return jsonResponse(200, response);
    },
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  const scan1 = await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`) });
  await user.click(scan1);
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.internal);
  // After a failure the balances are read again, in case the server did charge.
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/galaxy/api/gacha')).toHaveLength(2));
  await user.click(scan1);
  await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  const keys = fetch.mock.calls
    .filter(([url]) => url === '/galaxy/api/gacha/pull')
    .map(([, init]) => (init?.headers as Record<string, string>)['idempotency-key']);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('una tirada nueva tras una que salió bien lleva una clave nueva', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, { pulls: [pulled(1)], wallet: { coins: 250, dust: 0, signal: 9 }, view: view() }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  const scan1 = () => screen.getByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`) });
  await screen.findByRole('table', { name: copy.scanner.odds });
  await user.click(scan1());
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  await user.click(await within(stage).findByRole('button', { name: copy.scanner.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(scan1());
  await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  const keys = fetch.mock.calls.filter(([url]) => url === '/galaxy/api/gacha/pull').map(([, init]) => (init?.headers as Record<string, string>)['idempotency-key']);
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
});

test('un clic fuera del terminal no cierra el revelado y Escape primero salta al resumen (revisión final)', async () => {
  const response: PullResponse = { pulls: [pulled(1), pulled(2)], wallet: { coins: 250, dust: 0, signal: 0 }, view: view() };
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, response),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  // Players click fast to advance: a click on the veil around the terminal must not lose what they paid for.
  fireEvent.mouseDown(document.querySelector('.overlay')!);
  expect(screen.getByRole('dialog', { name: copy.scanner.revealTitle })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(await within(stage).findByRole('heading', { name: copy.scanner.summaryTitle(2) })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// «¡Escanear otra!» (Nov plan A1): from the summary, the same scan again without leaving the scanner.
function pullSequence(views: GachaView[]) {
  let n = 0;
  return () => {
    const v = views[Math.min(n, views.length - 1)]!;
    n += 1;
    return jsonResponse(200, { pulls: [pulled(100 + n)], wallet: v.wallet, view: v } satisfies PullResponse);
  };
}

test('tras escanear 1, «¡Escanear otra!» repite el escaneo con una clave nueva y Colección es violeta', async () => {
  const after = view({ wallet: { coins: 250, dust: 0, signal: 9 } });
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': pullSequence([after, view({ wallet: { coins: 250, dust: 0, signal: 8 } })]),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  const again = await within(stage).findByRole('button', { name: new RegExp(`${copy.scanner.again(1)}.*${copy.scanner.costSignals(1)}`) });
  expect(within(stage).getByRole('link', { name: copy.scanner.toCollection })).toHaveClass('pill-uv');
  expect(copy.scanner.toCollection).toBe('Colección');
  await user.click(again);
  // A new reveal starts (Saltar is back) with the second scan.
  expect(await within(screen.getByRole('dialog', { name: copy.scanner.revealTitle })).findByRole('button', { name: copy.scanner.skip })).toBeInTheDocument();
  const posts = fetch.mock.calls.filter(([url]) => url === '/galaxy/api/gacha/pull');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(String(posts[1]![1]?.body))).toEqual({ banner: 'deep-scan', count: 1, pay: 'signal' });
  const keys = posts.map(([, init]) => (init?.headers as Record<string, string>)['idempotency-key']);
  expect(keys[1]).not.toBe(keys[0]);
});

test('tras escanear 10 ofrece «¡Escanear otras 10!»', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, { pulls: [pulled(1), pulled(2)], wallet: { coins: 250, dust: 0, signal: 0 }, view: view({ wallet: { coins: 250, dust: 0, signal: 0 } }) }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  const again = await within(stage).findByRole('button', { name: new RegExp(copy.scanner.again(10).replace(/[¡!]/g, '.')) });
  // 10 signals cost 10 and none are left: off, and it says what is missing.
  expect(again).toBeDisabled();
  expect(within(stage).getByText(copy.scanner.missingSignals(10))).toBeInTheDocument();
});

test('sin saldo «¡Escanear otra!» se apaga y dice cuánto falta, sin llevar a la tienda', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view({ wallet: { coins: 150, dust: 0, signal: 0 } })),
    'POST /galaxy/api/gacha/pull': pullSequence([view({ wallet: { coins: 50, dust: 0, signal: 0 } })]),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costCoins(100)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  const again = await within(stage).findByRole('button', { name: new RegExp(`${copy.scanner.again(1).replace(/[¡!]/g, '.')}.*${copy.scanner.costCoins(100)}`) });
  expect(again).toBeDisabled();
  expect(within(stage).getByText('Te faltan 50 monedas')).toBeInTheDocument();
  expect(within(stage).queryByRole('link', { name: /tienda/i })).not.toBeInTheDocument();
});

test('tras el escaneo gratis, otra se paga con señales y nunca pide otro gratis', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view({ freePullAvailable: true })),
    'POST /galaxy/api/gacha/pull': pullSequence([view({ freePullAvailable: false })]),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(copy.scanner.free) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  await user.click(await within(stage).findByRole('button', { name: new RegExp(`${copy.scanner.again(1).replace(/[¡!]/g, '.')}.*${copy.scanner.costSignals(1)}`) }));
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/galaxy/api/gacha/pull')).toHaveLength(2));
  const second = fetch.mock.calls.filter(([url]) => url === '/galaxy/api/gacha/pull')[1]!;
  expect(JSON.parse(String(second[1]?.body))).toEqual({ banner: 'deep-scan', count: 1, pay: 'signal' });
});

test('si «¡Escanear otra!» falla, el error se ve en el resumen y se puede reintentar', async () => {
  let posts = 0;
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () =>
      ++posts === 1 ? jsonResponse(200, { pulls: [pulled(1)], wallet: { coins: 250, dust: 0, signal: 9 }, view: view({ wallet: { coins: 250, dust: 0, signal: 9 } }) }) : jsonResponse(409, { error: 'banner_closed' }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  const again = await within(stage).findByRole('button', { name: new RegExp(copy.scanner.again(1).replace(/[¡!]/g, '.')) });
  await user.click(again);
  expect(await within(stage).findByRole('alert')).toHaveTextContent(copy.errors.banner_closed);
  expect(again).toBeEnabled();
});

test('«¡Escanear otra!» repite en el mismo escáner: si el de evento ha cerrado, no escanea en otro (revisión A)', async () => {
  const event = { ...view().banners[0]!, id: 'ev-1', kind: 'event' as const, name: 'Primer contacto', currency: 'signal:ev', welcome: false };
  const both = view({ banners: [view().banners[0]!, event], wallet: { coins: 250, dust: 0, signal: 10, 'signal:ev': 5 } });
  const closed = view({ wallet: { coins: 250, dust: 0, signal: 10, 'signal:ev': 4 } });
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, both),
    'POST /galaxy/api/gacha/pull': pullSequence([closed]),
  });
  const user = userEvent.setup();
  renderAt('/escaner?tipo=evento', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  const again = await within(stage).findByRole('button', { name: new RegExp(copy.scanner.again(1).replace(/[¡!]/g, '.')) });
  expect(again).toBeDisabled();
  expect(within(stage).getByText(copy.scanner.againClosed)).toBeInTheDocument();
  expect(fetch.mock.calls.filter(([url]) => url === '/galaxy/api/gacha/pull')).toHaveLength(1);
});

test('mientras «¡Escanear otra!» espera, dice que está escaneando y no deja repetir', async () => {
  let posts = 0;
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => (++posts === 1 ? jsonResponse(200, { pulls: [pulled(1)], wallet: { coins: 250, dust: 0, signal: 9 }, view: view({ wallet: { coins: 250, dust: 0, signal: 9 } }) }) : (new Promise<Response>(() => {}) as unknown as Response)),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(1)}.*${copy.scanner.costSignals(1)}`) }));
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  await user.click(await within(stage).findByRole('button', { name: new RegExp(copy.scanner.again(1).replace(/[¡!]/g, '.')) }));
  const busy = await within(stage).findByRole('button', { name: new RegExp(copy.scanner.scanning) });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute('aria-busy', 'true');
});
