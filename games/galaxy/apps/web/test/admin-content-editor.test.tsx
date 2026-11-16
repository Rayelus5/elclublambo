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
