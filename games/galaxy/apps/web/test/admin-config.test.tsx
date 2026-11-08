import { CONFIG_KEYS, type MeResponse, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ConfigKeyScreen, ConfigScreen } from '../src/admin/ConfigScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The live config on the web (GDD §16.3, §16.6; M6b): the switches, each key's editor with live validation by path and
// the diff against what is live, publishing with reason and password, the history, and the gacha simulator.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.config;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const keys = CONFIG_KEYS.map((key) => ({ key, version: key === 'chat' ? 3 : 0, data: parseConfig(key, {}), createdAt: null, author: key === 'chat' ? 'rayelus' : null, note: null }));
/** The keys after someone published `chat` again (version 4, with `data`). */
const keysAfter = (data: object) => keys.map((k) => (k.key === 'chat' ? { ...k, version: 4, data: { ...k.data, ...data } } : k));
const keysCalls = (fetch: ReturnType<typeof mockApi>) => fetch.mock.calls.filter(([url]) => url === '/galaxy/api/admin/config/keys').length;
const posted = (fetch: ReturnType<typeof mockApi>, key: string) =>
  fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api/admin/config/${key}` && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));

function api(routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys),
    'GET /galaxy/api/admin/config/chat/versions': () => jsonResponse(200, [{ version: 3, data: { maxLength: 200 }, createdAt: '2026-11-08T10:00:00.000Z', createdBy: 'ad1', author: 'rayelus', note: 'Más corto' }]),
    'GET /galaxy/api/admin/config/gacha/versions': () => jsonResponse(200, []),
    'GET /galaxy/api/admin/config/probes/versions': () => jsonResponse(200, []),
    ...routes,
  });
}

test('los interruptores dicen su estado y apagar uno pide motivo y contraseña, y el botón dice lo que hace', async () => {
  const fetch = api({ 'POST /galaxy/api/admin/config/features': () => jsonResponse(201, { version: 1 }) });
  renderAt('/admin/configuracion', { '/admin/configuracion': <ConfigScreen /> });
  const user = userEvent.setup();
  const market = await screen.findByRole('switch', { name: t.switches.market });
  expect(market).toBeChecked();
  await user.click(market);
  const dialog = await screen.findByRole('dialog', { name: t.switchOff(t.switches.market) });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Mantenimiento');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.switchOff(t.switches.market) }));
  await waitFor(() => expect(posted(fetch, 'features')).toEqual([{ data: { market: false }, reason: 'Mantenimiento', password: 'mi-clave' }]));
  expect(screen.getByRole('link', { name: 'chat' })).toHaveAttribute('href', '/admin/configuracion/chat');
});

test('el editor comprueba el borrador por rutas, enseña qué cambia y publica solo eso, sobre la versión en la que se editó', async () => {
  let published = false;
  const fetch = api({
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, published ? keysAfter({ maxLength: 300 }) : keys),
    'POST /galaxy/api/admin/config/chat': () => {
      published = true;
      return jsonResponse(201, { version: 4 });
    },
  });
  renderAt('/admin/configuracion/chat', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const editor = await screen.findByRole('textbox', { name: t.editor });
  const draft = { ...parseConfig('chat', {}), maxLength: 5 };
  fireEvent.change(editor, { target: { value: JSON.stringify(draft, null, 2) } });
  expect(await screen.findByText('maxLength', { selector: 'code' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.publish })).toBeDisabled();
  fireEvent.change(editor, { target: { value: JSON.stringify({ ...draft, maxLength: 300 }, null, 2) } });
  expect(await screen.findByText(t.changed('maxLength', '280', '300'))).toBeInTheDocument();
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Mensajes más largos');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  await waitFor(() => expect(posted(fetch, 'chat')).toEqual([{ data: { maxLength: 300 }, baseVersion: 3, reason: 'Mensajes más largos', password: 'mi-clave' }]));
  // The success stays once the keys come back with the new version.
  expect(await screen.findByText(t.published(4))).toBeInTheDocument();
  await waitFor(() => expect(keysCalls(fetch)).toBeGreaterThan(1));
  await waitFor(() => expect(screen.getByText(t.noChanges)).toBeInTheDocument());
  expect(screen.getByText(t.published(4))).toBeInTheDocument();
});

test('quitar una entrada de un registro se ve como un cambio', async () => {
  api();
  renderAt('/admin/configuracion/probes', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const editor = await screen.findByRole('textbox', { name: t.editor });
  const probes = parseConfig('probes', {});
  const [first, ...rest] = Object.keys(probes.unlocks);
  fireEvent.change(editor, { target: { value: JSON.stringify({ ...probes, unlocks: Object.fromEntries(rest.map((k) => [k, probes.unlocks[k]])) }, null, 2) } });
  expect(await screen.findByText(t.removed(`unlocks.${first}`), { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(t.noChanges)).not.toBeInTheDocument();
});

test('si otro admin publicó mientras editabas, se dice y se puede cargar lo publicado', async () => {
  let moved = false;
  api({
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, moved ? keysAfter({ maxLength: 200 }) : keys),
    'POST /galaxy/api/admin/config/chat': () => {
      moved = true;
      return jsonResponse(409, { error: 'config_conflict' });
    },
  });
  renderAt('/admin/configuracion/chat', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const editor = await screen.findByRole('textbox', { name: t.editor });
  fireEvent.change(editor, { target: { value: JSON.stringify({ ...parseConfig('chat', {}), maxLength: 300 }, null, 2) } });
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Mensajes más largos');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  expect(await screen.findByText(copy.errors.config_conflict)).toBeInTheDocument();
  expect(await screen.findByText(t.moved(4))).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.reloadLive }));
  expect((screen.getByRole('textbox', { name: t.editor }) as HTMLTextAreaElement).value).toContain('"maxLength": 200');
  expect(screen.queryByText(t.moved(4))).not.toBeInTheDocument();
});

test('los problemas que encuentra el servidor al publicar se enseñan con su ruta', async () => {
  api({ 'POST /galaxy/api/admin/config/chat': () => jsonResponse(400, { error: 'config_invalid', issues: [{ path: 'words', message: 'Sobra una palabra' }] }) });
  renderAt('/admin/configuracion/chat', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const editor = await screen.findByRole('textbox', { name: t.editor });
  fireEvent.change(editor, { target: { value: JSON.stringify({ ...parseConfig('chat', {}), maxLength: 300 }, null, 2) } });
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Mensajes más largos');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('words', { selector: 'code' })).toBeInTheDocument();
  expect(alert).toHaveTextContent('Sobra una palabra');
});

test('el historial carga una versión vieja en el editor, para publicarla como nueva', async () => {
  api();
  renderAt('/admin/configuracion/chat', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.loadVersion(3) }));
  expect(((await screen.findByRole('textbox', { name: t.editor })) as HTMLTextAreaElement).value).toContain('"maxLength": 200');
  expect(screen.getByText(t.changed('maxLength', '280', '200'))).toBeInTheDocument();
});

test('el simulador del gachapón tira el borrador y lo compara con lo esperado, con decimales en español', async () => {
  api();
  renderAt('/admin/configuracion/gacha', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.sim.run(1000) }));
  const table = await screen.findByRole('table', { name: t.sim.title });
  const legendary = within(table).getByRole('rowheader', { name: copy.tiers.legendary }).closest('tr')!;
  expect(within(legendary).getAllByRole('cell')[0]).toHaveTextContent(/^\d+,\d{2} %$/);
  expect(screen.getByText(t.sim.every, { exact: false })).toBeInTheDocument();
  // A different draft clears the old run: what came out always belongs to the config next to it.
  const gacha = parseConfig('gacha', {});
  fireEvent.change(screen.getByRole('textbox', { name: t.editor }), { target: { value: JSON.stringify({ ...gacha, standard: { ...gacha.standard, hard: 25 } }, null, 2) } });
  await waitFor(() => expect(screen.queryByRole('table', { name: t.sim.title })).not.toBeInTheDocument());
});
