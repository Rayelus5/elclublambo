import { type DraftView, type MeResponse, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ContentScreen } from '../src/admin/content/ContentScreen';
import { copy } from '../src/copy/es';
import { useLocation } from 'react-router';
import { jsonResponse, mockApi, renderAt } from './render';

// The run content's page (the content editor, 2026-11-16, P2): changes go through server-side drafts any admin can
// resume — saved field by field as they are edited, merged with what was published since (rebase), tried in a test run,
// published with a reason and the password, or discarded. An old version can come back as a new draft.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const t = copy.admin.drafts;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const live = parseConfig('content', {});
const draft = (over: Partial<DraftView> = {}): DraftView => ({
  id: 'd1',
  title: 'Más vida al ácaro',
  status: 'open',
  revision: 1,
  fields: [{ key: 'content', field: 'hitCap' }],
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  stale: false,
  data: { content: { hitCap: 0.35 } },
  baseVersions: { content: 4 },
  publishedVersions: null,
  ...over,
});

function api(routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, { key: 'content', version: 4, data: live, createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/content/versions': () => jsonResponse(200, [{ version: 4, createdAt: '2026-11-15T10:00:00.000Z', author: 'rayelus', note: 'Vida de enemigos' }]),
    'GET /galaxy/api/admin/config-drafts': () => jsonResponse(200, [draft()]),
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft()),
    ...routes,
  });
}
/** Where the router is (the hangar's route in a test). */
function Where() {
  const l = useLocation();
  return <p>{`${l.pathname}${l.search}`}</p>;
}
const calls = (fetch: ReturnType<typeof mockApi>, method: string, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method).map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null));

test('lista los borradores abiertos y crea uno nuevo, que se abre', async () => {
  const d2 = draft({ id: 'd2', title: 'Sector nuevo', revision: 0, fields: [], data: {} });
  const fetch = api({ 'POST /galaxy/api/admin/config-drafts': () => jsonResponse(201, d2), 'GET /galaxy/api/admin/config-drafts/d2': () => jsonResponse(200, d2) });
  renderAt('/admin/configuracion/content', { '/admin/configuracion/content': <ContentScreen /> });
  const list = await screen.findByRole('list', { name: t.list });
  expect(await within(list).findByText('Más vida al ácaro')).toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(t.newTitle), 'Sector nuevo');
  await user.click(screen.getByRole('button', { name: t.create }));
  expect(await screen.findByRole('heading', { name: 'Sector nuevo' })).toBeInTheDocument();
  expect(calls(fetch, 'POST', '/galaxy/api/admin/config-drafts')).toEqual([{ title: 'Sector nuevo' }]);
});

test('editar guarda solo el campo que cambia, con su revisión', async () => {
  const fetch = api({ 'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, draft({ revision: 2, data: { content: { hitCap: 0.3 } } })) });
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const editor = await screen.findByRole('textbox', { name: t.json });
  const value = JSON.parse((editor as HTMLTextAreaElement).value) as { hitCap: number };
  expect(value.hitCap).toBe(0.35);
  fireEvent.change(editor, { target: { value: JSON.stringify({ ...value, hitCap: 0.3 }) } });
  await waitFor(() => expect(calls(fetch, 'PUT', '/galaxy/api/admin/config-drafts/d1/field')).toEqual([{ key: 'content', field: 'hitCap', value: 0.3, revision: 1 }]), { timeout: 3000 });
  expect(await screen.findByText(t.saved)).toBeInTheDocument();
});

test('un borrador desfasado se junta con lo publicado; un conflicto se resuelve eligiendo un lado', async () => {
  const fetch = api({
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft({ stale: true })),
    'POST /galaxy/api/admin/config-drafts/d1/rebase': (b) =>
      (b as { resolutions?: object }).resolutions && Object.keys((b as { resolutions: object }).resolutions).length > 0
        ? jsonResponse(200, { draft: draft({ revision: 2 }), conflicts: [] })
        : jsonResponse(200, { draft: draft({ stale: true }), conflicts: [{ key: 'content', field: 'hitCap' }] }),
  });
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.rebase }));
  const dialog = await screen.findByRole('dialog', { name: t.conflictsTitle });
  await user.click(within(dialog).getByRole('radio', { name: t.keepMine }));
  await user.click(within(dialog).getByRole('button', { name: t.applyRebase }));
  await waitFor(() => expect(calls(fetch, 'POST', '/galaxy/api/admin/config-drafts/d1/rebase').at(-1)).toEqual({ resolutions: { content: { hitCap: { '*': 'mine' } } } }));
});

test('se publica con motivo y contraseña, y vuelve a la lista', async () => {
  const fetch = api({ 'POST /galaxy/api/admin/config-drafts/d1/publish': () => jsonResponse(201, { versions: { content: 5 } }) });
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(copy.admin.fields.reason), 'Más vida');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  expect(await screen.findByText(t.published(5))).toBeInTheDocument();
  expect(calls(fetch, 'POST', '/galaxy/api/admin/config-drafts/d1/publish')).toEqual([{ reason: 'Más vida', password: 'mi-clave' }]);
  expect(await screen.findByRole('list', { name: t.list })).toBeInTheDocument();
});

test('«Probar en incursión» lleva al hangar con el borrador', async () => {
  api();
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen />, '/incursion': <Where /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: t.tryInRun }));
  expect(await screen.findByText('/incursion?borrador=d1')).toBeInTheDocument();
});

test('una versión vieja vuelve como borrador nuevo', async () => {
  const old = { ...live, hitCap: 0.5 };
  const fetch = api({
    'GET /galaxy/api/admin/config/content/versions/4': () => jsonResponse(200, { version: 4, data: old, createdAt: '2026-11-15T10:00:00.000Z', author: 'rayelus', note: 'Vida de enemigos' }),
    'POST /galaxy/api/admin/config-drafts': () => jsonResponse(201, draft({ id: 'd3', title: t.fromVersionTitle(4), revision: 0, fields: [], data: {} })),
    'PUT /galaxy/api/admin/config-drafts/d3/field': () => jsonResponse(200, draft({ id: 'd3', revision: 1, data: { content: { hitCap: 0.5 } } })),
    'GET /galaxy/api/admin/config-drafts/d3': () => jsonResponse(200, draft({ id: 'd3', title: t.fromVersionTitle(4), revision: 1, data: { content: { hitCap: 0.5 } } })),
  });
  renderAt('/admin/configuracion/content', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.fromVersion(4) }));
  expect(await screen.findByRole('heading', { name: t.fromVersionTitle(4) })).toBeInTheDocument();
  expect(calls(fetch, 'PUT', '/galaxy/api/admin/config-drafts/d3/field')).toEqual([{ key: 'content', field: 'hitCap', value: 0.5, revision: 0 }]);
});

test('se descarta tras confirmar', async () => {
  const fetch = api({ 'DELETE /galaxy/api/admin/config-drafts/d1': () => new Response(null, { status: 204 }) });
  renderAt('/admin/configuracion/content?borrador=d1', { '/admin/configuracion/content': <ContentScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.discard }));
  const confirm = await screen.findByRole('alertdialog', { name: t.discardTitle });
  await user.click(within(confirm).getByRole('button', { name: t.discardConfirm }));
  await waitFor(() => expect(calls(fetch, 'DELETE', '/galaxy/api/admin/config-drafts/d1')).toHaveLength(1));
  expect(await screen.findByRole('list', { name: t.list })).toBeInTheDocument();
});

