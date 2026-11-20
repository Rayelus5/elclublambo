import { companionWarnings, type DraftView, type MeResponse, parseConfig } from '@galaxy/shared';
import { contentSchema, DEFAULT_CONTENT } from '@galaxy/sim';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ContentScreen } from '../src/admin/content/ContentScreen';
import { uniqueId } from '../src/admin/content/ids';
import { runQuickSim } from '../src/admin/content/quicksim';
import { copy } from '../src/copy/es';
import { pickOption } from './pick';
import { jsonResponse, mockApi, renderAt } from './render';

// What the independent review of P7–P9 found (the content editor, 2026-11-16), each proved fixed.
afterEach(() => vi.unstubAllGlobals());

const cancel = vi.fn();
vi.mock('../src/admin/content/quicksim', () => ({ runQuickSim: vi.fn(() => ({ promise: new Promise(() => {}), cancel })) }));

const t = copy.admin.content;
const w = t.wizard;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const live = parseConfig('content', {});
const draft = (content: Record<string, unknown> = {}): DraftView => ({
  id: 'd1',
  title: 'Revisión dos',
  status: 'open',
  revision: 1,
  fields: [],
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  stale: false,
  data: { content },
  baseVersions: {},
  publishedVersions: null,
});
function open(path: string, content: Record<string, unknown> = {}, sectorsFail = false) {
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, { key: 'content', version: 4, data: live, createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/content/versions': () => jsonResponse(200, []),
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft(content)),
    'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, { ...draft(content), revision: 2 }),
    'GET /galaxy/api/admin/config/sectors': () =>
      sectorsFail ? jsonResponse(500, { error: 'internal' }) : jsonResponse(200, { key: 'sectors', version: 2, data: parseConfig('sectors', {}), createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/probes': () => jsonResponse(200, { key: 'probes', version: 2, data: parseConfig('probes', {}), createdAt: null, author: null, note: null }),
  });
  const view = renderAt(`/admin/configuracion/content?borrador=d1&${path}`, { '/admin/configuracion/content': <ContentScreen /> });
  return { fetch, view };
}
const putsOf = (fetch: ReturnType<typeof mockApi>, key: string) =>
  fetch.mock.calls
    .filter(([u, init]) => u === '/galaxy/api/admin/config-drafts/d1/field' && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init!.body)) as { key: string; field: string; value: unknown })
    .filter((p) => p.key === key);
const stepTo = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(within(screen.getByRole('tablist', { name: w.steps })).getByRole('tab', { name: new RegExp(name) }));

test('el identificador que sigue al nombre nunca cae en el de otra entrada', async () => {
  const arc = live.weapons.find((x) => x.id === 'arc')!;
  open('zona=arsenal&lista=weapons');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Añadir/ }));
  const name = await waitFor(() => screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === t.newEntity)!);
  fireEvent.change(name, { target: { value: 'Arc' } });
  expect(screen.getByRole('heading', { name: 'Arc' })).toBeInTheDocument();
  expect(screen.getAllByRole('textbox').some((el) => (el as HTMLInputElement).value === 'arc-2')).toBe(true);
  expect(screen.queryByRole('heading', { name: arc.name })).toBeNull();
});

test('un borrador con sectores rotos no rompe la simulación rápida ni la página', async () => {
  open('', { sectors: [null], probes: [null] });
  expect(await screen.findByRole('tablist', { name: t.areas })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: t.quickSim })).toBeInTheDocument();
});

test('la simulación rápida se para al cerrar el borrador', async () => {
  const { view } = open('');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.quickSimRun }));
  expect(runQuickSim).toHaveBeenCalled();
  view.unmount();
  expect(cancel).toHaveBeenCalled();
});

test('sin la configuración de sectores un sector nuevo no se añade, y lo dice', async () => {
  open('crear=sector', {}, true);
  const user = userEvent.setup();
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Sector sin datos' } });
  await stepTo(user, w.review);
  expect(screen.getByText(w.needsCompanions)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: w.add })).toBeDisabled();
});

test('un sector basado en el de temporada es normal, sin los textos de su modelo, y su paga se escribe sin pelear', async () => {
  const rift = live.sectors.find((s) => s.season)!;
  const sectors = structuredClone(live.sectors);
  sectors.find((s) => s.season)!.lore = 'El texto de la Fisura';
  const { fetch } = open('crear=sector', { sectors });
  const user = userEvent.setup();
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Sector copiado' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), rift.name);
  await stepTo(user, w.unlock);
  const pay = screen.getByRole('textbox', { name: w.pay });
  await user.clear(pay);
  await user.type(pay, '0,8');
  expect(pay).toHaveValue('0,8');
  await stepTo(user, w.review);
  await user.click(screen.getByRole('button', { name: w.add }));
  await waitFor(() => expect(putsOf(fetch, 'content').map((p) => p.field)).toContain('sectors'), { timeout: 3000 });
  const saved = (putsOf(fetch, 'content').find((p) => p.field === 'sectors')!.value as { id: string; season: boolean; lore?: string }[]).find((s) => s.id === 'sector-copiado')!;
  expect(saved.season).toBe(false);
  expect(saved.lore).toBeUndefined();
  await waitFor(() => expect(putsOf(fetch, 'sectors').map((p) => p.field)).toContain('pay'));
  expect((putsOf(fetch, 'sectors').find((p) => p.field === 'pay')!.value as Record<string, number>)['sector-copiado']).toBe(0.8);
});

test('el contenido se guarda antes que el desbloqueo y la paga del sector nuevo', async () => {
  const { fetch } = open('crear=sector');
  const user = userEvent.setup();
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Orden de guardado' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), live.sectors[1]!.name);
  await stepTo(user, w.review);
  await user.click(screen.getByRole('button', { name: w.add }));
  await waitFor(() => expect(putsOf(fetch, 'sectors').length).toBe(2));
  const order = fetch.mock.calls
    .filter(([u, init]) => u === '/galaxy/api/admin/config-drafts/d1/field' && init?.method === 'PUT')
    .map(([, init]) => (JSON.parse(String(init!.body)) as { key: string }).key);
  expect(order[0]).toBe('content');
});

test('un problema de otro sector no impide añadir un enemigo nuevo', async () => {
  const sectors = structuredClone(live.sectors);
  sectors[1]!.spawns[0]!.weight = -1;
  open('crear=enemigo', { sectors });
  const user = userEvent.setup();
  fireEvent.change(await screen.findByRole('textbox', { name: w.name }), { target: { value: 'Ácaro bien colocado' } });
  await pickOption(user, screen.getByRole('combobox', { name: w.basedOn }), live.enemies.find((e) => e.id === 'mite')!.name);
  await stepTo(user, w.review);
  expect(screen.getByRole('button', { name: w.add })).toBeEnabled();
});

test('un sector de temporada que ya estaba publicado no avisa entre temporadas', () => {
  const sectors = { ...parseConfig('sectors', {}), season: null };
  expect(companionWarnings({ content: DEFAULT_CONTENT, live: DEFAULT_CONTENT, sectors, probes: parseConfig('probes', {}) })).toEqual([]);
});

test('«constructor» y las demás claves heredadas no son identificadores', () => {
  expect(uniqueId('constructor', () => false)).toBe('constructor-2');
  const c = structuredClone(DEFAULT_CONTENT);
  c.enemies[0]!.id = 'constructor';
  expect(contentSchema.safeParse(c).success).toBe(false);
});
