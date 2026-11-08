import type { CollectionPage, GalaxySummary, PlanetariumCard, PlanetariumView, PlanetariumVisit, PublicGalaxy } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { PlanetariumScreen } from '../src/planetarium/PlanetariumScreen';
import { VisitScreen } from '../src/planetarium/VisitScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The planetarium (GDD §10.5, §14.2; M4c-2): six pedestals under the dome, the empty ones offer to exhibit a galaxy and
// the full ones hold its card with «Retirar»; the prestige and its experience bonus, the visits; a field to visit
// someone's planetarium by name and the featured ones; a visit shows only the owner's cards, without actions.

const t = copy.planetarium;
const TRAITS = { galaxy_type: 'spiral', arms: '3', palette: 'solar_gold', phenomenon: 'pulsar', size: 'large', core: 'bright', star_density: 'normal', background: 'deep_void' };
const pub = (over: Partial<PublicGalaxy> = {}): PublicGalaxy => ({
  id: 'g1',
  seed: '12345',
  tier: 'legendary',
  finish: 'holo',
  traits: TRAITS,
  name: 'Kathra',
  designation: 'GX-ABCDEF',
  featured: false,
  level: 3,
  ...over,
});
const mine = (over: Partial<GalaxySummary> = {}): GalaxySummary => ({ ...pub(), createdAt: '2026-11-06T20:00:00Z', exhibited: true, ...over });
const card = (owner: string, prestige: number): PlanetariumCard => ({ owner, prestige, exhibits: 3, cover: pub({ id: `c-${owner}`, name: `Portada ${owner}` }) });
const view = (over: Partial<PlanetariumView> = {}): PlanetariumView => ({
  slots: 6,
  exhibits: [mine(), null, mine({ id: 'g2', name: 'Orvel', tier: 'rare', finish: 'normal' }), null, null, null],
  prestige: 16,
  bonus: 0.016,
  visits: 12,
  featured: [card('vega', 40), card('lyra', 12)],
  ...over,
});
const screens = {
  '/planetario': <PlanetariumScreen />,
  '/planetario/:username': <VisitScreen />,
};
const puts = (fetch: ReturnType<typeof mockApi>) =>
  fetch.mock.calls.filter(([url, init]) => url === '/galaxy/api/planetarium/exhibits' && init?.method === 'PUT').map(([, init]) => JSON.parse(String(init!.body)));

test('la cúpula con seis pedestales: los vacíos se exponen y los llenos tienen su carta y Retirar', async () => {
  mockApi({ 'GET /galaxy/api/planetarium': () => jsonResponse(200, view()) });
  renderAt('/planetario', screens);
  const pedestals = await screen.findByRole('list', { name: t.pedestals });
  expect(within(pedestals).getAllByRole('listitem')).toHaveLength(6);
  expect(within(pedestals).getAllByRole('button', { name: /Exponer galaxia/ })).toHaveLength(4);
  expect(within(pedestals).getByRole('button', { name: t.exhibitAt(2) })).toHaveTextContent('Exponer galaxia');
  expect(within(pedestals).getByRole('article', { name: 'Kathra' })).toBeInTheDocument();
  expect(within(pedestals).getByRole('button', { name: t.removeNamed('Kathra') })).toHaveTextContent(t.remove);
  expect(within(pedestals).getByRole('button', { name: t.change('Orvel') })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t.title);
  expect(screen.getByRole('link', { name: t.back })).toHaveAttribute('href', '/estacion');
});

test('el prestigio, su bonus de experiencia y las visitas', async () => {
  mockApi({ 'GET /galaxy/api/planetarium': () => jsonResponse(200, view()) });
  renderAt('/planetario', screens);
  const panel = await screen.findByRole('region', { name: t.prestige });
  expect(panel).toHaveTextContent('16');
  expect(panel).toHaveTextContent('+1,6 % de experiencia en las incursiones');
  expect(t.bonus(0.05)).toBe('+5 % de experiencia en las incursiones');
  expect(panel).toHaveTextContent('12 visitas');
  expect(t.visits(1)).toBe('1 visita');
});

test('elegir una galaxia en el diálogo envía los seis pedestales en su orden', async () => {
  const page: CollectionPage = {
    items: [mine(), mine({ id: 'g3', name: 'Nimbus', tier: 'epic', exhibited: undefined })],
    counts: { common: 0, uncommon: 0, rare: 0, epic: 1, legendary: 1 },
    fusion: { count: 5, dust: [20, 50, 120, 300] },
  };
  const fetch = mockApi({
    'GET /galaxy/api/planetarium': () => jsonResponse(200, view()),
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page),
    'PUT /galaxy/api/planetarium/exhibits': (b) => {
      const ids = (b as { galaxies: (string | null)[] }).galaxies;
      return jsonResponse(200, view({ exhibits: ids.map((id) => (id === null ? null : mine({ id, name: id === 'g3' ? 'Nimbus' : id === 'g2' ? 'Orvel' : 'Kathra' }))) }));
    },
  });
  const user = userEvent.setup();
  renderAt('/planetario', screens);
  await user.click(await screen.findByRole('button', { name: t.exhibitAt(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.pickerTitle });
  // The one already on display elsewhere cannot go twice.
  expect(within(dialog).getByRole('button', { name: t.pick('Kathra') })).toBeDisabled();
  expect(dialog).toHaveTextContent(t.exhibited);
  await user.click(within(dialog).getByRole('button', { name: t.pick('Nimbus') }));
  await waitFor(() => expect(puts(fetch)).toEqual([{ galaxies: ['g1', 'g3', 'g2', null, null, null] }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByRole('button', { name: t.removeNamed('Nimbus') })).toBeInTheDocument();
});

test('si exponer falla, el diálogo se cierra, el error se ve y la colección se vuelve a leer', async () => {
  const page: CollectionPage = {
    items: [mine({ id: 'g3', name: 'Nimbus', tier: 'epic', exhibited: undefined })],
    counts: { common: 0, uncommon: 0, rare: 0, epic: 1, legendary: 0 },
    fusion: { count: 5, dust: [20, 50, 120, 300] },
  };
  const fetch = mockApi({
    'GET /galaxy/api/planetarium': () => jsonResponse(200, view()),
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page),
    'PUT /galaxy/api/planetarium/exhibits': () => jsonResponse(404, { error: 'galaxy_not_found' }),
  });
  const user = userEvent.setup();
  renderAt('/planetario', screens);
  await user.click(await screen.findByRole('button', { name: t.exhibitAt(2) }));
  const dialog = await screen.findByRole('dialog', { name: t.pickerTitle });
  await user.click(within(dialog).getByRole('button', { name: t.pick('Nimbus') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.galaxy_not_found);
  // Opening the picker again reads the collection again, so it no longer offers what is gone.
  const reads = () => fetch.mock.calls.filter(([url]) => url === '/galaxy/api/galaxies?sort=rarity&limit=30').length;
  expect(reads()).toBe(1);
  await user.click(screen.getByRole('button', { name: t.exhibitAt(2) }));
  await screen.findByRole('dialog', { name: t.pickerTitle });
  await waitFor(() => expect(reads()).toBe(2));
});

test('mientras se guarda, los pedestales no envían otra fila', async () => {
  let release: (r: Response) => void = () => undefined;
  const fetch = mockApi({
    'GET /galaxy/api/planetarium': () => jsonResponse(200, view()),
    'PUT /galaxy/api/planetarium/exhibits': () => new Promise<Response>((r) => (release = r)) as unknown as Response,
  });
  const user = userEvent.setup();
  renderAt('/planetario', screens);
  await user.click(await screen.findByRole('button', { name: t.removeNamed('Kathra') }));
  await waitFor(() => expect(screen.getByRole('button', { name: t.exhibitAt(2) })).toBeDisabled());
  expect(screen.getByRole('button', { name: t.change('Orvel') })).toBeDisabled();
  expect(screen.getByRole('button', { name: t.removeNamed('Orvel') })).toBeDisabled();
  release(jsonResponse(200, view({ exhibits: [null, null, mine({ id: 'g2', name: 'Orvel' }), null, null, null] })));
  await waitFor(() => expect(screen.getByRole('button', { name: t.exhibitAt(2) })).toBeEnabled());
  expect(puts(fetch)).toHaveLength(1);
});

test('el prestigio explica que el acabado suma un punto más', () => {
  expect(t.prestigeHint).toBe('Cada galaxia expuesta suma según su rareza, y un punto más si su acabado no es normal. Como mucho +5 %');
});

test('retirar deja su pedestal vacío y los demás donde estaban', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/planetarium': () => jsonResponse(200, view()),
    'PUT /galaxy/api/planetarium/exhibits': () => jsonResponse(200, view({ exhibits: [null, null, mine({ id: 'g2', name: 'Orvel' }), null, null, null] })),
  });
  const user = userEvent.setup();
  renderAt('/planetario', screens);
  await user.click(await screen.findByRole('button', { name: t.removeNamed('Kathra') }));
  await waitFor(() => expect(puts(fetch)).toEqual([{ galaxies: [null, null, 'g2', null, null, null] }]));
  expect(await screen.findByRole('button', { name: t.exhibitAt(1) })).toBeInTheDocument();
});

test('un planetario vacío invita a exponer', async () => {
  mockApi({ 'GET /galaxy/api/planetarium': () => jsonResponse(200, view({ exhibits: [null, null, null, null, null, null], prestige: 0, bonus: 0, visits: 0, featured: [] })) });
  renderAt('/planetario', screens);
  expect(await screen.findByText(t.emptyMine)).toBeInTheDocument();
  expect(screen.getByText(t.featuredEmpty)).toBeInTheDocument();
});

test('el campo «Visitar un planetario» lleva a su planetario, y los destacados enlazan a cada uno', async () => {
  mockApi({
    'GET /galaxy/api/planetarium': () => jsonResponse(200, view()),
    'GET /galaxy/api/planetarium/visit/vega': () => jsonResponse(200, { owner: 'vega', exhibits: [null, null, null, null, null, null], prestige: 0, visits: 1 }),
  });
  const user = userEvent.setup();
  renderAt('/planetario', screens);
  const featured = await screen.findByRole('list', { name: t.featured });
  expect(within(featured).getByRole('link', { name: t.featuredItem('vega', 40) })).toHaveAttribute('href', '/planetario/vega');
  expect(within(featured).getByRole('link', { name: t.featuredItem('lyra', 12) })).toHaveAttribute('href', '/planetario/lyra');

  const form = screen.getByRole('search', { name: t.visitTitle });
  const go = within(form).getByRole('button', { name: t.visitGo });
  expect(go).toBeDisabled();
  await user.type(within(form).getByLabelText(t.visitLabel), ' Vega ');
  await user.click(go);
  expect(await screen.findByRole('heading', { level: 1, name: t.of('vega') })).toBeInTheDocument();
});

test('la visita enseña al dueño, sus cartas para verlas en 3D, su prestigio y sus visitas', async () => {
  const visit: PlanetariumVisit = { owner: 'vega', exhibits: [pub({ name: 'Antares' }), null, null, pub({ id: 'g4', name: 'Bellatrix', tier: 'uncommon', finish: 'normal' }), null, null], prestige: 15, visits: 3 };
  mockApi({ 'GET /galaxy/api/planetarium/visit/vega': () => jsonResponse(200, visit) });
  renderAt('/planetario/vega', screens);
  expect(await screen.findByRole('heading', { level: 1, name: t.of('vega') })).toBeInTheDocument();
  const pedestals = screen.getByRole('list', { name: t.pedestals });
  expect(within(pedestals).getAllByRole('listitem')).toHaveLength(6);
  expect(within(pedestals).getByRole('article', { name: 'Antares' })).toBeInTheDocument();
  expect(within(pedestals).getByRole('article', { name: 'Bellatrix' })).toBeInTheDocument();
  // No actions on someone else's cards, only a look in 3D (the owner's request).
  expect(within(pedestals).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([copy.inspector.openOf('Antares'), copy.inspector.openOf('Bellatrix')]);
  const panel = screen.getByRole('region', { name: t.prestige });
  expect(panel).toHaveTextContent('15');
  expect(panel).toHaveTextContent('3 visitas');
  expect(screen.getByRole('link', { name: t.backToMine })).toHaveAttribute('href', '/planetario');
});

test('un planetario visitado sin nada expuesto lo dice', async () => {
  mockApi({ 'GET /galaxy/api/planetarium/visit/lyra': () => jsonResponse(200, { owner: 'lyra', exhibits: [null, null, null, null, null, null], prestige: 0, visits: 1 }) });
  renderAt('/planetario/lyra', screens);
  expect(await screen.findByText(t.emptyVisit)).toBeInTheDocument();
  expect(t.emptyVisit).toBe('Todavía no ha expuesto ninguna galaxia');
});

test('un nombre sin planetario lo dice y lleva de vuelta', async () => {
  mockApi({ 'GET /galaxy/api/planetarium/visit/nadie': () => jsonResponse(404, { error: 'planetarium_not_found' }) });
  renderAt('/planetario/nadie', screens);
  expect(await screen.findByText('No hay ningún planetario con ese nombre')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: t.backToMine })).toHaveAttribute('href', '/planetario');
  expect(screen.queryByRole('list', { name: t.pedestals })).toBeNull();
});

test('si la vista no llega lo dice y no enseña pedestales', async () => {
  const fetch = mockApi({ 'GET /galaxy/api/planetarium': () => jsonResponse(500, { error: 'internal' }) });
  renderAt('/planetario', screens);
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.internal);
  expect(puts(fetch)).toEqual([]);
  expect(screen.queryByRole('list', { name: t.pedestals })).toBeNull();
});
