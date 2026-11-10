import type { GachaView } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ScannerScreen } from '../src/scanner/ScannerScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The event scanner (open beta): it must not look like the standard one. Its tab says «Escáner de evento», its screen
// turns purple, it pays with the event's own signals (a purple ticket in the wallet, apart from the normal ones), and
// its featured galaxy is announced big: the trait, how many scans until it is certain, and the way there.
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
afterEach(() => vi.unstubAllGlobals());

const t = copy.scanner;
const standard = { id: 'deep-scan', kind: 'standard' as const, name: 'Escáner profundo', currency: 'signal', nextRates: [0.5, 0.28, 0.13, 0.06, 0.03], sinceLegendary: 3, untilGuarantee: 7, welcome: false };
const event = {
  id: 'primer-contacto',
  kind: 'event' as const,
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
};
const view = (over: Partial<GachaView> = {}): GachaView => ({
  banners: [standard, event],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 250, dust: 0, signal: 10, 'signal:primer-contacto': 4 },
  ...over,
});

test('el escáner de evento se distingue: su pestaña dice «Escáner de evento», su pantalla se tiñe y paga con las señales de evento', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view()) });
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  const tab = await screen.findByRole('button', { name: new RegExp(t.eventTab) });
  // Its badge: the event tickets held.
  expect(tab).toHaveTextContent(copy.hub.resource.eventSignal(4));
  expect(screen.getByRole('button', { name: new RegExp(standard.name) })).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.scanner.is-event')).toBeNull();
  await userEvent.click(tab);
  expect(tab).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { level: 2, name: t.eventTab })).toBeInTheDocument();
  // The screen's title follows the scanner chosen.
  expect(screen.getByRole('heading', { level: 1, name: t.eventTab })).toBeInTheDocument();
  expect(screen.getByText(event.name)).toBeInTheDocument();
  expect(document.querySelector('.scanner.is-event')).not.toBeNull();
  expect(screen.getByText(t.withEventSignals(4))).toBeInTheDocument();
});

test('la destacada del evento se anuncia en grande: el rasgo, cuántos escaneos faltan para que sea segura y el camino hecho', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view()) });
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(t.eventTab) }));
  const card = screen.getByRole('region', { name: t.featuredTitle });
  expect(card).toHaveTextContent(copy.traitValues.phenomenon.supernova!);
  expect(card).toHaveTextContent(copy.traitNames.phenomenon!);
  expect(card).toHaveTextContent(t.untilFeatured(36));
  const bar = within(card).getByRole('progressbar', { name: t.featuredProgress });
  expect(bar).toHaveAttribute('aria-valuenow', '9');
  expect(bar).toHaveAttribute('aria-valuemax', '45');
});

test('/escaner?tipo=evento abre directamente el escáner de evento', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view()) });
  renderAt('/escaner?tipo=evento', { '/escaner': <ScannerScreen /> });
  expect(await screen.findByRole('heading', { level: 2, name: t.eventTab })).toBeInTheDocument();
});

test('el monedero enseña las señales de evento en su propio ticket, aparte de las normales; sin evento ni saldo, no sale', async () => {
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view()) });
  const { unmount } = renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  expect(await screen.findByRole('img', { name: copy.hub.resource.eventSignal(4) })).toHaveClass('event-signal');
  expect(screen.getByRole('img', { name: copy.hub.resource.signal(10) })).toBeInTheDocument();
  unmount();
  vi.unstubAllGlobals();
  mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, view({ banners: [standard], wallet: { coins: 250, dust: 0, signal: 10 } })) });
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await screen.findByRole('img', { name: copy.hub.resource.signal(10) });
  expect(screen.queryByRole('img', { name: copy.hub.resource.eventSignal(0) })).toBeNull();
});
