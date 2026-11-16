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
