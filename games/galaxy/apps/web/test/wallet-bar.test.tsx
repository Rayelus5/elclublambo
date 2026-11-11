import type { GachaView, Wallet } from '@galaxy/shared';
import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { GACHA_KEY } from '../src/api/economy';
import { LAB_KEY } from '../src/api/lab';
import { HANGAR_KEY } from '../src/api/runs';
import { STATION_KEY } from '../src/api/station';
import { syncWallet } from '../src/api/wallet';
import { copy } from '../src/copy/es';
import { WalletBar } from '../src/hub/WalletBar';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The wallet's chips lead where each resource is used: the signals to the Escáner (the event ones to its event tab),
// material to the refinery. Each says where it leads; one that would lead to where you already are is just a number.
// And one wallet lives in several caches: after any action the new one goes into all of them.
afterEach(() => vi.unstubAllGlobals());

const r = copy.hub.resource;
const wallet: Wallet = { coins: 250, dust: 40, signal: 3, 'signal:primer-contacto': 4, material: 12, components: 7 };
const gacha = (): GachaView => ({
  banners: [
    { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: [0.5, 0.28, 0.13, 0.06, 0.03], sinceLegendary: 0, untilGuarantee: 10, welcome: false },
    {
      id: 'primer-contacto',
      kind: 'event',
      name: 'Escáner de Primer contacto',
      currency: 'signal:primer-contacto',
      featured: { trait: 'phenomenon', value: 'supernova' },
      endsAt: '2026-11-23T23:00:00.000Z',
      nextRates: [0.5, 0.28, 0.13, 0.06, 0.03],
      sinceLegendary: 0,
      untilGuarantee: 10,
      welcome: false,
      untilFeatured: 36,
      featuredEvery: 45,
    },
  ],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet,
});

test('las señales llevan al Escáner y las de evento a su pestaña; cada una dice adónde lleva', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
  renderAt('/', { '/': <WalletBar wallet={wallet} /> });
  const signal = await screen.findByRole('link', { name: new RegExp(r.signal(3)) });
  expect(signal).toHaveAttribute('href', '/escaner');
  expect(signal).toHaveAccessibleName(`${r.signal(3)}. ${r.goTo.scanner}`);
  const event = await screen.findByRole('link', { name: new RegExp(r.eventSignal(4)) });
  expect(event).toHaveAttribute('href', '/escaner?tipo=evento');
  await userEvent.click(event);
  expect(locationOf(screen.getByTestId('location'))).toMatchObject({ pathname: '/escaner', search: '?tipo=evento' });
});

test('en el Escáner, el boleto de la pestaña abierta es solo un número y el otro cambia de pestaña', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
  renderAt('/escaner', { '/escaner': <WalletBar wallet={wallet} /> });
  await screen.findByRole('link', { name: new RegExp(r.eventSignal(4)) });
  expect(screen.queryByRole('link', { name: new RegExp(r.signal(3)) })).toBeNull();
  expect(screen.getByRole('img', { name: r.signal(3) })).toBeInTheDocument();
});

test('el material y los componentes se muestran donde se piden, el material abre la refinería', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
  const onRefinery = vi.fn();
  renderAt('/estacion', { '/estacion': <WalletBar wallet={wallet} components material={{ onOpen: onRefinery }} /> });
  const material = await screen.findByRole('button', { name: new RegExp(copy.station.resource.material(12)) });
  expect(material).toHaveAccessibleName(`${copy.station.resource.material(12)}. ${r.goTo.refinery}`);
  await userEvent.click(material);
  expect(onRefinery).toHaveBeenCalledOnce();
  expect(screen.getByRole('img', { name: copy.station.resource.components(7) })).toBeInTheDocument();
  // Material, components, dust, coins, signals, event signals: the station's order.
  const order = [...document.querySelectorAll('.res')].map((el) => [...el.classList].find((c) => c !== 'res' && c !== 'res-link'));
  expect(order).toEqual(['material', 'components', 'dust', 'coins', 'signal', 'event-signal']);
});

test('syncWallet pone el monedero nuevo en todas las vistas que lo llevan, sin crear las que no están', () => {
  const qc = new QueryClient();
  const old: Wallet = { coins: 1, dust: 1, signal: 1 };
  qc.setQueryData(GACHA_KEY, { ...gacha(), wallet: old });
  qc.setQueryData(STATION_KEY, { wallet: old, rooms: [] });
  qc.setQueryData(LAB_KEY, { wallet: old, nodes: [] });
  syncWallet(qc, wallet);
  expect(qc.getQueryData<{ wallet: Wallet }>(GACHA_KEY)?.wallet).toEqual(wallet);
  expect(qc.getQueryData<{ wallet: Wallet }>(STATION_KEY)?.wallet).toEqual(wallet);
  expect(qc.getQueryData<{ wallet: Wallet; nodes: unknown[] }>(LAB_KEY)).toEqual({ wallet, nodes: [] });
  expect(qc.getQueryData(HANGAR_KEY)).toBeUndefined();
});
