import { type DraftView, type MeResponse, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ContentScreen } from '../src/admin/content/ContentScreen';
import { AREAS } from '../src/admin/content/descriptors';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The content editor (2026-11-16, P4): a draft of the run content edited visually — by area, an entity list with search
// and a form for the chosen one —, saved as it changes, with the JSON still one tab away. What is published cannot be
// removed (its id is permanent); what the draft added can.
afterEach(() => vi.unstubAllGlobals());

// The quick check plays the bot in a worker; here it answers at once.
vi.mock('../src/admin/content/quicksim', () => ({
  runQuickSim: vi.fn(() => ({
    promise: Promise.resolve({
      live: [
        { minutes: 6, layer: 2, level: 10, beatBoss: true, end: 'died' },
        { minutes: 8, layer: 3, level: 12, beatBoss: true, end: 'time' },
      ],
      draft: [
        { minutes: 3, layer: 1, level: 6, beatBoss: false, end: 'died' },
        { minutes: 4, layer: 1, level: 7, beatBoss: false, end: 'died' },
      ],
    }),
    cancel: () => {},
  })),
}));

const t = copy.admin.content;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const live = parseConfig('content', {});
const draft = (over: Partial<DraftView> = {}): DraftView => ({
  id: 'd1',
  title: 'Retoques de fauna',
  status: 'open',
  revision: 1,
  fields: [],
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  stale: false,
  data: {},
  baseVersions: {},
  publishedVersions: null,
  ...over,
});
function api(routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, { key: 'content', version: 4, data: live, createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/content/versions': () => jsonResponse(200, []),
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft()),
    'GET /galaxy/api/admin/config/sectors': () => jsonResponse(200, { key: 'sectors', version: 2, data: parseConfig('sectors', {}), createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/probes': () => jsonResponse(200, { key: 'probes', version: 2, data: parseConfig('probes', {}), createdAt: null, author: null, note: null }),
    ...routes,
  });
}
const puts = (fetch: ReturnType<typeof mockApi>) =>
  fetch.mock.calls.filter(([u, init]) => u === '/galaxy/api/admin/config-drafts/d1/field' && init?.method === 'PUT').map(([, init]) => JSON.parse(String(init!.body)) as { field: string; value: unknown });
const fauna = AREAS.find((a) => a.id === 'fauna')!;
const mite = live.enemies.find((e) => e.id === 'mite')!;

test('las zonas se recorren y una entidad se busca y se abre', async () => {
  api();
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: fauna.title }));
  const list = screen.getByRole('listbox', { name: t.entities });
  await user.type(screen.getByRole('searchbox', { name: t.search }), mite.name.slice(0, 4));
  await user.click(within(list).getByRole('option', { name: new RegExp(mite.name) }));
  expect(screen.getByRole('heading', { name: mite.name })).toBeInTheDocument();
});

test('un enlace directo abre la zona y la entidad', async () => {
  api();
  renderAt('/admin/configuracion/content?borrador=d1&zona=fauna&id=mite', { '/admin/configuracion/content': <ContentScreen /> });
  expect(await screen.findByRole('heading', { name: mite.name })).toBeInTheDocument();
});

test('editar un campo de una entidad guarda su lista en el borrador', async () => {
  const fetch = api({ 'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2 })) });
  renderAt('/admin/configuracion/content?borrador=d1&zona=fauna&id=mite', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: mite.name });
  const hp = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === String(mite.hp).replace('.', ','))!;
  fireEvent.change(hp, { target: { value: String(mite.hp + 5) } });
  await waitFor(() => expect(puts(fetch).map((p) => p.field)).toContain('enemies'), { timeout: 3000 });
  const saved = puts(fetch).find((p) => p.field === 'enemies')!.value as { id: string; hp: number }[];
  expect(saved.find((e) => e.id === 'mite')!.hp).toBe(mite.hp + 5);
});

test('lo publicado no se quita; lo que añade el borrador sí', async () => {
  api({ 'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2 })) });
  renderAt('/admin/configuracion/content?borrador=d1&zona=fauna&id=mite', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: mite.name });
  expect(screen.getByRole('button', { name: t.remove(mite.name) })).toBeDisabled();
  expect(screen.getByText(t.publishedStays)).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t.duplicate(mite.name) }));
  const copyName = t.copyOf(mite.name);
  expect(await screen.findByRole('heading', { name: copyName })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.remove(copyName) })).toBeEnabled();
});

test('la pestaña JSON sigue mostrando todo el borrador', async () => {
  api();
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: t.jsonTab }));
  expect(screen.getByRole('textbox', { name: copy.admin.drafts.json })).toBeInTheDocument();
});

test('el dibujo se elige de una galería y se guarda', async () => {
  const fetch = api({ 'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2 })) });
  renderAt('/admin/configuracion/content?borrador=d1&zona=fauna&id=mite', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: mite.name });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t.changeArt }));
  const gallery = screen.getByRole('dialog', { name: t.gallery });
  expect(within(gallery).getByRole('tab', { name: t.groups.fauna })).toHaveAttribute('aria-selected', 'true');
  await user.click(within(gallery).getByRole('button', { name: 'cell' }));
  expect(screen.queryByRole('dialog', { name: t.gallery })).toBeNull();
  await waitFor(() => expect(puts(fetch).map((p) => p.field)).toContain('enemies'), { timeout: 3000 });
  const saved = puts(fetch).find((p) => p.field === 'enemies')!.value as { id: string; sprite: string }[];
  expect(saved.find((e) => e.id === 'mite')!.sprite).toBe('cell');
});

test('una entrada en uso dice dónde y no se quita hasta dejar de usarla', async () => {
  const fresh = { ...structuredClone(mite), id: 'zz-nuevo', name: 'Ácaro nuevo' };
  const sectors = structuredClone(live.sectors);
  sectors[0]!.spawns[0]!.enemy = 'zz-nuevo';
  api({ 'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft({ data: { content: { enemies: [...live.enemies, fresh], sectors } } })) });
  renderAt('/admin/configuracion/content?borrador=d1&zona=fauna&id=zz-nuevo', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: 'Ácaro nuevo' });
  expect(screen.getByText(t.usedIn(1))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.remove('Ácaro nuevo') })).toBeDisabled();
  expect(screen.getByText(t.usedStays)).toBeInTheDocument();
});

test('los niveles de un arma son una tabla, con lo que su tipo no usa apagado', async () => {
  const { DESCRIPTORS } = await import('../src/admin/content/descriptors');
  const pulse = live.weapons.find((w) => w.id === 'pulse')!;
  const fetch = api({ 'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2 })) });
  renderAt('/admin/configuracion/content?borrador=d1&zona=arsenal&id=pulse', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: pulse.name });
  const table = screen.getByRole('table', { name: DESCRIPTORS['weapons[].levels']!.label });
  const label = (f: string) => DESCRIPTORS[`weapons[].levels[].${f}`]!.label;
  expect(within(table).getByRole('columnheader', { name: new RegExp(label('bounces')) })).toHaveClass('off');
  expect(within(table).getByRole('columnheader', { name: new RegExp(label('damage')) })).not.toHaveClass('off');
  expect(within(table).getAllByRole('row')).toHaveLength(pulse.levels.length + 1);
  fireEvent.change(within(table).getByRole('textbox', { name: t.cell(label('damage'), 2) }), { target: { value: '99' } });
  await waitFor(() => expect(puts(fetch).map((p) => p.field)).toContain('weapons'), { timeout: 3000 });
  const saved = puts(fetch).find((p) => p.field === 'weapons')!.value as { id: string; levels: { damage: number }[] }[];
  expect(saved.find((w) => w.id === 'pulse')!.levels[1]!.damage).toBe(99);
});

test('un tipo se elige sabiendo qué hace, y lo que aún no existe pide programación', async () => {
  const { DESCRIPTORS, VOCABS } = await import('../src/admin/content/descriptors');
  api();
  renderAt('/admin/configuracion/content?borrador=d1&zona=fauna&id=mite', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: mite.name });
  const explain = VOCABS.behavior![mite.behavior.kind]!.explain;
  expect(screen.getByText(explain)).toBeInTheDocument();
  const kind = screen.getByRole('combobox', { name: DESCRIPTORS['enemies[].behavior.kind']!.label });
  await userEvent.setup().click(kind);
  expect(screen.getByRole('option', { name: t.needsCode })).toHaveAttribute('aria-disabled', 'true');
});

test('las fases de un Núcleo se ven sobre su barra de vida, y siguen editándose', async () => {
  const { VOCABS } = await import('../src/admin/content/descriptors');
  const hive = live.bosses.find((b) => b.id === 'hive')!;
  api();
  renderAt('/admin/configuracion/content?borrador=d1&zona=nucleos&id=hive', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: hive.name });
  const chart = screen.getByRole('list', { name: t.phasesChart });
  const phases = within(chart).getAllByRole('listitem');
  expect(phases).toHaveLength(hive.phases.length);
  expect(phases[0]).toHaveTextContent(t.phaseSpan(1, 100, Math.round(hive.phases[1]!.below * 100)));
  expect(phases[0]).toHaveTextContent(VOCABS.bossPattern![hive.phases[0]!.patterns[0]!.kind]!.label);
  expect(screen.getByRole('button', { name: /Añadir fase/ })).toBeInTheDocument();
});

test('un sector enseña cuándo sale cada enemigo y cuándo llegan sus oleadas', async () => {
  const nebula = live.sectors[0]!;
  api();
  renderAt(`/admin/configuracion/content?borrador=d1&zona=sectores&id=${nebula.id}`, { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: nebula.name });
  const chart = screen.getByRole('list', { name: t.spawnsChart });
  const first = live.enemies.find((e) => e.id === nebula.spawns[0]!.enemy)!;
  expect(within(chart).getAllByRole('listitem')).toHaveLength(nebula.spawns.length);
  expect(within(chart).getAllByRole('listitem')[0]).toHaveTextContent(t.spawnFrom(first.name, nebula.spawns[0]!.from));
  expect(screen.getByRole('list', { name: t.wavesChart })).toBeInTheDocument();
});

test('los pesos de los eventos se ven como su parte del total', async () => {
  const { VOCABS } = await import('../src/admin/content/descriptors');
  api();
  renderAt('/admin/configuracion/content?borrador=d1&zona=eventos&lista=events', { '/admin/configuracion/content': <ContentScreen /> });
  const chart = await screen.findByRole('list', { name: t.weightsChart });
  const w = live.events.weights;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  expect(chart).toHaveTextContent(`${VOCABS.eventKind!.wreck!.label} ${Math.round((w.wreck / total) * 100)} %`);
});

test('las reacciones se ven en una tabla de parejas de elementos', async () => {
  const { VOCABS } = await import('../src/admin/content/descriptors');
  const first = live.elements.reactions[0]!;
  api();
  renderAt('/admin/configuracion/content?borrador=d1&zona=elementos', { '/admin/configuracion/content': <ContentScreen /> });
  const table = await screen.findByRole('table', { name: t.reactionsChart });
  const [a, b] = first.pair;
  const cell = within(table).getByRole('cell', { name: t.reactionCell(VOCABS.element![a]!.label, VOCABS.element![b]!.label, first.name) });
  expect(cell).toHaveTextContent(first.name);
});

test('los avisos se ven y hay que leerlos antes de publicar', async () => {
  const fresh = { ...structuredClone(mite), id: 'zz-solo', name: 'Ácaro suelto' };
  api({ 'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft({ fields: [{ key: 'content', field: 'enemies' }], data: { content: { enemies: [...live.enemies, fresh] } } })) });
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const warnings = await screen.findByRole('region', { name: t.warnings });
  await waitFor(() => expect(within(warnings).getByText(/No sale en ningún sector/)).toBeInTheDocument());
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Un ácaro nuevo');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'secreto');
  const publish = screen.getByRole('button', { name: copy.admin.drafts.publish });
  expect(publish).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: t.ackWarnings }));
  expect(publish).toBeEnabled();
});

test('la simulación rápida compara lo publicado con el borrador', async () => {
  api();
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.quickSimRun }));
  const table = await screen.findByRole('table', { name: t.quickSimTable });
  const minutes = within(table).getByRole('row', { name: new RegExp(t.quickSimRows.minutes) });
  expect(minutes).toHaveTextContent('7');
  expect(minutes).toHaveTextContent('3,5');
  expect(within(table).getByRole('row', { name: new RegExp(t.quickSimRows.boss) })).toHaveTextContent('2 de 2');
});

test('un texto vacío enseña el de siempre y se puede escribir el propio', async () => {
  const { DESCRIPTORS } = await import('../src/admin/content/descriptors');
  const { SECTOR_TEXT } = await import('../src/codex/texts');
  const rings = live.sectors.find((s) => s.id === 'frost-rings')!;
  const fetch = api({ 'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2 })) });
  renderAt('/admin/configuracion/content?borrador=d1&zona=sectores&id=frost-rings', { '/admin/configuracion/content': <ContentScreen /> });
  await screen.findByRole('heading', { name: rings.name });
  const lore = screen.getByRole('textbox', { name: DESCRIPTORS['sectors[].lore']!.label });
  expect(lore).toHaveValue('');
  expect(lore).toHaveAttribute('placeholder', SECTOR_TEXT['frost-rings']);
  const radio = screen.getByRole('textbox', { name: DESCRIPTORS['sectors[].radio']!.label });
  expect(radio).toHaveAttribute('placeholder', copy.arena.radio.sectors['frost-rings']);
  fireEvent.change(lore, { target: { value: 'Un texto propio' } });
  await waitFor(() => expect(puts(fetch).map((p) => p.field)).toContain('sectors'), { timeout: 3000 });
  const saved = puts(fetch).find((p) => p.field === 'sectors')!.value as { id: string; lore?: string }[];
  expect(saved.find((s) => s.id === 'frost-rings')!.lore).toBe('Un texto propio');
});
