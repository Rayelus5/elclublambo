import type { GachaView, PulledGalaxy, PullResponse, Tier } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
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
