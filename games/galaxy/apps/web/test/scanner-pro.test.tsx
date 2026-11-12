import type { GachaView, PulledGalaxy, PullResponse, Tier } from '@galaxy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import type { ProCinemaProps } from '../src/scanner/pro/ProCinema';
import { ScannerScreen } from '../src/scanner/ScannerScreen';
import { resetPrefs, setPrefs } from '../src/settings/prefs';
import { jsonResponse, mockApi, renderAt } from './render';

// The pro reveal on the scanner screen (plan «escáner pro», part B): the bands close the instant the player scans,
// while the request is out; the cinema (stubbed here: jsdom has no WebGL) takes over when the galaxies arrive; Saltar
// lands on the same summary as always; a failed scan opens the bands again and says why — on the scanner, or over the
// last summary when it was «¡Escanear otra!». With the setting off, the classic reveal plays.

vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
vi.mock('../src/ui/webgl', () => ({ hasWebGL2: () => true }));
vi.mock('../src/scanner/pro/ProCinema', () => ({
  default: function StubCinema(p: ProCinemaProps) {
    useEffect(() => {
      p.control.current = {
        advance: () => true,
        skip: () => {
          p.onPhase({ label: 'resumen', kind: 'resumen', at: 10, dur: 0.6 });
          return true;
        },
        seek: () => {},
        setRate: () => {},
        pause: () => {},
        resume: () => {},
        script: { phases: [] } as never,
        time: () => 0,
      };
      p.onPhase({ label: 'ignicion', kind: 'ignicion', at: 0, dur: 1 });
      // Once, like the real cinema.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="cinema">{p.pulls.length}</div>;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  resetPrefs();
  localStorage.clear();
});

const view = (over: Partial<GachaView> = {}): GachaView => ({
  banners: [{ id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: [0.5, 0.28, 0.13, 0.06, 0.03], sinceLegendary: 3, untilGuarantee: 7, welcome: false }],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 2500, dust: 0, signal: 30 },
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
const response = (n: number): PullResponse => ({ pulls: Array.from({ length: n }, (_, i) => pulled(i, i === n - 1 ? 'legendary' : 'common')), wallet: view().wallet, view: view() });
const pull10 = () => screen.findByRole('button', { name: new RegExp(`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}`) });

test('las bandas cierran al pulsar, mientras la petición viaja; llega la tirada, la cinemática empieza y Saltar va al resumen', async () => {
  let answer: (r: Response) => void = () => {};
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => new Promise<Response>((r) => (answer = r)) as unknown as Response,
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await pull10());
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  const root = stage.querySelector<HTMLElement>('.pro-root')!;
  expect(root.dataset['state']).toBe('closing');
  expect(within(stage).getByRole('status')).toHaveTextContent(copy.scanner.linking);
  await act(async () => answer(jsonResponse(200, response(10))));
  expect(await within(stage).findByTestId('cinema')).toHaveTextContent('10');
  expect(root.dataset['state']).toBe('playing');
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  expect(await within(stage).findByRole('heading', { name: copy.scanner.summaryTitle(10) })).toBeInTheDocument();
  expect(within(stage).getAllByRole('article')).toHaveLength(10);
  await user.click(within(stage).getByRole('button', { name: copy.scanner.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('si la tirada falla, las bandas se abren y el escáner dice por qué', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(409, { error: 'insufficient_funds' }),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await pull10());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 2000 });
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.insufficient_funds);
});

test('si falla «¡Escanear otra!», vuelve el resumen anterior con el aviso', async () => {
  let calls = 0;
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => (++calls === 1 ? jsonResponse(200, response(10)) : jsonResponse(409, { error: 'insufficient_funds' })),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await pull10());
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  await within(stage).findByTestId('cinema');
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  await user.click(await within(stage).findByRole('button', { name: new RegExp(copy.scanner.again(10)) }));
  await waitFor(() => expect(within(stage).getByRole('heading', { name: copy.scanner.summaryTitle(10) })).toBeInTheDocument(), { timeout: 2000 });
  expect(within(stage).getByRole('alert')).toHaveTextContent(copy.errors.insufficient_funds);
  expect(within(stage).getAllByRole('article')).toHaveLength(10);
});

test('con la presentación pro apagada en Ajustes, se ve la revelación clásica', async () => {
  setPrefs({ scannerPro: false });
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, view()),
    'POST /galaxy/api/gacha/pull': () => jsonResponse(200, response(10)),
  });
  const user = userEvent.setup();
  renderAt('/escaner', { '/escaner': <ScannerScreen /> });
  await user.click(await pull10());
  const stage = await screen.findByRole('dialog', { name: copy.scanner.revealTitle });
  expect(stage.querySelector('.pro-root')).toBeNull();
  expect(within(stage).getByText(copy.scanner.progress(1, 10))).toBeInTheDocument();
});
