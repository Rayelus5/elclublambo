import type { CollectionPage, GachaView, GalaxySummary, Tier } from '@galaxy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { CollectionScreen } from '../src/collection/CollectionScreen';
import { copy } from '../src/copy/es';
import type { ProCinemaProps } from '../src/scanner/pro/ProCinema';
import { resetPrefs, setPrefs } from '../src/settings/prefs';
import { jsonResponse, mockApi, renderAt } from './render';

// A fusion with the pro reveal (plan «fusión pro»): «Fusionar» closes the bands at once, while the request is out, with
// no CSS fusion; the cinema (stubbed here: jsdom has no WebGL) opens with the galaxies going in and the new one; Saltar
// lands on the summary. A failed fusion opens the bands again and the fusion bar says why, the choice still made.
// With «Presentación pro» off, the fusion plays as before.

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
    return (
      <div data-testid="cinema" data-intro={p.intro} data-inputs={(p.inputs ?? []).map((g) => g.name).join(',')}>
        {p.pulls.map((g) => g.name).join(',')}
      </div>
    );
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  resetPrefs();
  localStorage.clear();
});

const g = (id: string, tier: Tier = 'common', name = `Gal ${id}`): GalaxySummary => ({
  id,
  seed: String(5000 + id.charCodeAt(id.length - 1)),
  tier,
  finish: 'normal',
  traits: { galaxy_type: 'spiral', palette: 'andromeda_blue', phenomenon: 'none' },
  name,
  designation: `GX-${id.toUpperCase().padStart(6, '0')}`,
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
});
const page = (): CollectionPage => ({
  items: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => g(id)),
  counts: { common: 6, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
  fusion: { count: 5, dust: [20, 50, 120, 300] },
});
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust: 40, signal: 0 } };
const screens = { '/coleccion': <CollectionScreen />, '/coleccion/:id': <CollectionScreen /> };

async function chooseFive(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText(copy.hub.resource.dust(40));
  await user.click(screen.getByRole('button', { name: copy.collection.fuse }));
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) await user.click(screen.getByRole('button', { name: copy.collection.select(`Gal ${id}`) }));
  await user.click(within(screen.getByRole('region', { name: copy.collection.fuse })).getByRole('button', { name: copy.collection.fuseConfirm }));
}

test('fusionar con la presentación pro: las bandas cierran mientras responde, la cinemática lleva las que entran y Saltar va al resumen', async () => {
  let answer: (r: Response) => void = () => {};
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page()),
    'POST /galaxy/api/galaxies/fuse': () => new Promise<Response>((r) => (answer = r)) as unknown as Response,
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await chooseFive(user);
  const stage = await screen.findByRole('dialog', { name: copy.collection.revealTitle });
  const root = stage.querySelector<HTMLElement>('.pro-root')!;
  expect(root.dataset['state']).toBe('closing');
  expect(within(stage).getByRole('status')).toHaveTextContent(copy.collection.fusingNow);
  // No CSS fusion under the cinema.
  expect(screen.queryByRole('status', { name: copy.collection.fusionLabel })).not.toBeInTheDocument();
  await act(async () => answer(jsonResponse(200, { galaxy: g('n1', 'uncommon', 'Zenveae'), wallet: { coins: 0, dust: 20, signal: 0 } })));
  const cinema = await within(stage).findByTestId('cinema');
  expect(cinema).toHaveTextContent('Zenveae');
  expect(cinema.dataset['intro']).toBe('fusion');
  expect(cinema.dataset['inputs']).toBe('Gal c1,Gal c2,Gal c3,Gal c4,Gal c5');
  await user.click(within(stage).getByRole('button', { name: copy.scanner.skip }));
  expect(await within(stage).findByRole('article', { name: 'Zenveae' })).toBeInTheDocument();
  await user.click(within(stage).getByRole('button', { name: copy.scanner.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  // The fusion is done: the bar is gone and the dust is spent.
  expect(screen.queryByRole('region', { name: copy.collection.fuse })).not.toBeInTheDocument();
  expect(screen.getByLabelText(copy.hub.resource.dust(20))).toBeInTheDocument();
});

test('si la fusión falla, las bandas se abren y la barra dice por qué, con las cinco aún elegidas', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page()),
    'POST /galaxy/api/galaxies/fuse': () => jsonResponse(409, { error: 'invalid_fusion' }),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await chooseFive(user);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 2000 });
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.invalid_fusion);
  expect(screen.getByRole('region', { name: copy.collection.fuse })).toHaveTextContent(copy.collection.fuseProgress(5, 5));
});

test('con la presentación pro apagada, la fusión se ve como siempre', async () => {
  setPrefs({ scannerPro: false });
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page()),
    'POST /galaxy/api/galaxies/fuse': () => jsonResponse(200, { galaxy: g('n1', 'uncommon', 'Zenveae'), wallet: { coins: 0, dust: 20, signal: 0 } }),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await chooseFive(user);
  expect(screen.getByRole('status', { name: copy.collection.fusionLabel })).toBeInTheDocument();
  expect(document.querySelector('.pro-root')).toBeNull();
});
