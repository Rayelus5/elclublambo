import { type DraftView, type MeResponse, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ContentScreen } from '../src/admin/content/ContentScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The content editor's deferred minors (2026-11-16, after the owner's go-ahead), each proved fixed.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.content;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const live = parseConfig('content', {});
const draft = (content: Record<string, unknown> = {}, fields: DraftView['fields'] = []): DraftView => ({
  id: 'd1',
  title: 'Menores',
  status: 'open',
  revision: 1,
  fields,
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  stale: false,
  data: { content },
  baseVersions: {},
  publishedVersions: null,
});
function open(_path: string, content: Record<string, unknown> = {}, fields: DraftView['fields'] = []) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, { key: 'content', version: 4, data: live, createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/content/versions': () => jsonResponse(200, []),
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft(content, fields)),
    'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, { ...draft(content, [{ key: 'content', field: 'enemies' }]), revision: 2 }),
    'POST /galaxy/api/admin/config-drafts/d1/publish': () => jsonResponse(201, { versions: { content: 5 } }),
    'GET /galaxy/api/admin/config/sectors': () => jsonResponse(200, { key: 'sectors', version: 2, data: parseConfig('sectors', {}), createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/probes': () => jsonResponse(200, { key: 'probes', version: 2, data: parseConfig('probes', {}), createdAt: null, author: null, note: null }),
  });
}
function mount(path: string, content: Record<string, unknown> = {}, fields: DraftView['fields'] = []) {
  const fetch = open(path, content, fields);
  renderAt(`/admin/configuracion/content?borrador=d1&${path}`, { '/admin/configuracion/content': <ContentScreen /> });
  return fetch;
}
const calls = (fetch: ReturnType<typeof mockApi>) => fetch.mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);
const mite = live.enemies.find((e) => e.id === 'mite')!;

test('publicar espera a que se guarde lo último que se cambió', async () => {
  const fetch = mount('zona=fauna&id=mite', { hitCap: 0.35 }, [{ key: 'content', field: 'hitCap' }]);
  await screen.findByRole('heading', { name: mite.name });
  const hp = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === String(mite.hp).replace('.', ','))!;
  fireEvent.change(hp, { target: { value: String(mite.hp + 1) } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Un poco más de vida');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'secreto');
  await user.click(screen.getByRole('button', { name: copy.admin.drafts.publish }));
  await waitFor(() => expect(calls(fetch)).toContain('POST /galaxy/api/admin/config-drafts/d1/publish'));
  const order = calls(fetch).filter((c) => c.includes('/field') || c.includes('/publish'));
  expect(order[0]).toBe('PUT /galaxy/api/admin/config-drafts/d1/field');
  expect(order.at(-1)).toBe('POST /galaxy/api/admin/config-drafts/d1/publish');
});

test('«dónde se usa» sigue contando aunque otra parte del borrador esté rota', async () => {
  const sectors = structuredClone(live.sectors) as unknown[];
  (sectors[2] as { spawns: unknown }).spawns = null;
  mount('zona=fauna&id=mite', { sectors });
  await screen.findByRole('heading', { name: mite.name });
  expect(screen.queryByText(t.unused)).toBeNull();
  expect(screen.getByText(/Se usa en \d+ sitio/)).toBeInTheDocument();
});

test('la tabla de niveles marca la celda con un problema y dice cuál', async () => {
  const weapons = structuredClone(live.weapons);
  weapons.find((w) => w.id === 'pulse')!.levels[1]!.damage = -5;
  mount('zona=arsenal&id=pulse', { weapons });
  const pulse = live.weapons.find((w) => w.id === 'pulse')!;
  await screen.findByRole('heading', { name: pulse.name });
  const damage = (await import('../src/admin/content/descriptors')).DESCRIPTORS['weapons[].levels[].damage']!.label;
  const cell = await waitFor(() => screen.getByRole('textbox', { name: t.cell(damage, 2) }));
  await waitFor(() => expect(cell).toHaveAttribute('aria-invalid', 'true'));
  expect(within(cell.closest('.ce-levels') as HTMLElement).getByText(new RegExp(`${t.levelRow(2)}.*${damage}`))).toBeInTheDocument();
});

test('al cambiar de entrada la ficha empieza cerrada, sin arrastrar lo abierto de la anterior', async () => {
  mount('zona=fauna&id=mite');
  await screen.findByRole('heading', { name: mite.name });
  const user = userEvent.setup();
  const more = screen.getAllByText(/Más ajustes/)[0]!.closest('details')!;
  await user.click(more.querySelector('summary')!);
  expect(more).toHaveAttribute('open');
  const other = live.enemies.find((e) => e.id !== 'mite')!;
  await user.click(within(screen.getByRole('listbox', { name: t.entities })).getByRole('option', { name: new RegExp(other.name) }));
  await screen.findByRole('heading', { name: other.name });
  for (const d of document.querySelectorAll('.ce-entity details.cf-more')) expect(d).not.toHaveAttribute('open');
});

test('las pestañas de un asistente se recorren con las flechas y muestran su panel', async () => {
  mount('crear=enemigo');
  const tabs = await screen.findByRole('tablist', { name: t.wizard.steps });
  const all = within(tabs).getAllByRole('tab');
  all[0]!.focus();
  fireEvent.keyDown(all[0]!, { key: 'ArrowRight' });
  expect(all[1]).toHaveAttribute('aria-selected', 'true');
  expect(all[1]).toHaveFocus();
  const panel = screen.getByRole('tabpanel');
  expect(panel).toHaveAttribute('aria-labelledby', all[1]!.id);
  expect(all[1]).toHaveAttribute('aria-controls', panel.id);
  fireEvent.keyDown(all[1]!, { key: 'End' });
  expect(all.at(-1)).toHaveAttribute('aria-selected', 'true');
});
