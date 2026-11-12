import { CONFIG_KEYS, type MeResponse, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ConfigKeyScreen, ConfigScreen } from '../src/admin/ConfigScreen';
import { CATEGORIES, KEY_INFO } from '../src/admin/forms/labels';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';
import { pickOption } from './pick';

// The live config on the web (GDD §16.3, §16.6; M6b; forms in polish phase 4): the switches, the categories, each key
// as a form with live checks by field and «Qué cambia» in words, publishing with reason and password, the history, and
// the gacha simulator.
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
});

test('la portada agrupa los ajustes por categorías y cada clave se llama por su nombre', async () => {
  api();
  renderAt('/admin/configuracion', { '/admin/configuracion': <ConfigScreen /> });
  const settings = await screen.findByRole('region', { name: t.keysTitle });
  for (const c of CATEGORIES) expect(within(settings).getByRole('heading', { name: c.title })).toBeInTheDocument();
  expect(within(settings).getByRole('link', { name: new RegExp(`^${KEY_INFO.chat.title}`) })).toHaveAttribute('href', '/admin/configuracion/chat');
});

test('el formulario comprueba cada campo, dice qué cambia en palabras y publica solo eso, sobre la versión en la que se editó', async () => {
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
  expect(await screen.findByRole('heading', { level: 1, name: KEY_INFO.chat.title })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: t.jsonTab })).toBeNull();
  const length = screen.getByLabelText('Caracteres por mensaje');
  await user.clear(length);
  await user.type(length, '5');
  expect(length).toHaveAttribute('aria-invalid', 'true');
  expect(within(screen.getByRole('region', { name: t.issuesTitle })).getByText('Caracteres por mensaje')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.publish })).toBeDisabled();
  await user.clear(length);
  await user.type(length, '300');
  expect(await screen.findByText('Caracteres por mensaje pasa de 280 a 300')).toBeInTheDocument();
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

test('los porcentajes se escriben de 0 a 100 y se guardan de 0 a 1', async () => {
  const fetch = api({ 'GET /galaxy/api/admin/config/market/versions': () => jsonResponse(200, []), 'POST /galaxy/api/admin/config/market': () => jsonResponse(201, { version: 1 }) });
  renderAt('/admin/configuracion/market', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const commission = await screen.findByLabelText('Comisión de cada venta');
  expect(commission).toHaveValue('7');
  await user.clear(commission);
  await user.type(commission, '8,5');
  expect(await screen.findByText('Comisión de cada venta pasa de 7 % a 8,5 %')).toBeInTheDocument();
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Más comisión');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  await waitFor(() => expect(posted(fetch, 'market')[0]?.data).toEqual({ commission: 0.085 }));
});

test('una lista se edita con tarjetas: añadir abre la nueva, y quitarla la saca de lo que cambia', async () => {
  api({ 'GET /galaxy/api/admin/config/boosts/versions': () => jsonResponse(200, []) });
  renderAt('/admin/configuracion/boosts', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const list = await screen.findByRole('region', { name: 'Multiplicadores' });
  await user.click(within(list).getByRole('button', { name: 'Añadir multiplicador' }));
  await user.type(within(list).getByLabelText('Nombre'), 'Doble polvo');
  await pickOption(user, within(list).getByLabelText('Qué multiplica'), 'Polvo estelar');
  const factor = within(list).getByLabelText('Por cuánto');
  await user.clear(factor);
  await user.type(factor, '2');
  // The id follows the name, without accents, until it is written by hand.
  expect(within(list).getByLabelText('Identificador')).toHaveValue('doble-polvo');
  expect(await screen.findByText(/^Se añade multiplicador «Doble polvo» a Multiplicadores$/)).toBeInTheDocument();
  await user.click(within(list).getByRole('button', { name: 'Quitar Doble polvo' }));
  expect(await screen.findByText(t.noChanges)).toBeInTheDocument();
});

test('en Avanzado, quitar una entrada con nombre se ve como un cambio, y la pestaña JSON enseña el mismo borrador', async () => {
  api();
  renderAt('/admin/configuracion/probes', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  expect(await screen.findByRole('note')).toHaveTextContent(t.advancedNote);
  const unlocks = screen.getByRole('region', { name: 'Qué desbloquea cada sonda' });
  const first = Object.keys(parseConfig('probes', {}).unlocks)[0]!;
  const name = DEFAULT_CONTENT.probes.find((p) => p.id === first)!.name;
  await user.click(within(unlocks).getByRole('button', { name: `Quitar ${name}` }));
  expect(await screen.findByText(`Se quita Qué desbloquea cada sonda › ${name}`)).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: t.jsonTab }));
  const json = (screen.getByRole('textbox', { name: t.editor }) as HTMLTextAreaElement).value;
  expect(JSON.parse(json).unlocks[first]).toBeUndefined();
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
  const length = await screen.findByLabelText('Caracteres por mensaje');
  await user.clear(length);
  await user.type(length, '300');
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Mensajes más largos');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  expect(await screen.findByText(copy.errors.config_conflict)).toBeInTheDocument();
  expect(await screen.findByText(t.moved(4))).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.reloadLive }));
  expect(screen.getByLabelText('Caracteres por mensaje')).toHaveValue('200');
  expect(screen.queryByText(t.moved(4))).not.toBeInTheDocument();
});

test('los problemas que encuentra el servidor al publicar se enseñan con su ruta', async () => {
  api({ 'POST /galaxy/api/admin/config/chat': () => jsonResponse(400, { error: 'config_invalid', issues: [{ path: 'words', message: 'Sobra una palabra' }] }) });
  renderAt('/admin/configuracion/chat', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const length = await screen.findByLabelText('Caracteres por mensaje');
  await user.clear(length);
  await user.type(length, '300');
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Mensajes más largos');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(screen.getByRole('button', { name: t.publish }));
  const alert = await screen.findByText('Sobra una palabra', { exact: false });
  expect(alert.closest('[role="alert"]')).toHaveTextContent('words');
});

test('el historial carga una versión vieja en el formulario, para publicarla como nueva', async () => {
  api();
  renderAt('/admin/configuracion/chat', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.loadVersion(3) }));
  expect(screen.getByLabelText('Caracteres por mensaje')).toHaveValue('200');
  expect(screen.getByText('Caracteres por mensaje pasa de 280 a 200')).toBeInTheDocument();
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
  const standard = screen.getByRole('group', { name: 'Escáner estándar' });
  const hard = within(standard).getByLabelText('Legendaria segura en el escaneo');
  await user.clear(hard);
  await user.type(hard, '25');
  await waitFor(() => expect(screen.queryByRole('table', { name: t.sim.title })).not.toBeInTheDocument());
});

test('un identificador publicado no se cambia aunque se reordene la lista; uno nuevo sigue a su nombre', async () => {
  const live = { list: [{ id: 'finde', name: 'Doble polvo', currency: 'dust', factor: 2, startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2027-01-03T00:00:00.000Z' }] };
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys.map((k) => (k.key === 'boosts' ? { ...k, version: 2, data: live } : k))),
    'GET /galaxy/api/admin/config/boosts/versions': () => jsonResponse(200, []),
  });
  renderAt('/admin/configuracion/boosts', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const list = await screen.findByRole('region', { name: 'Multiplicadores' });
  await user.click(within(list).getByRole('button', { name: 'Añadir multiplicador' }));
  await user.type(within(list).getByLabelText('Nombre'), 'Nuevo');
  expect(within(list).getByLabelText('Identificador')).toHaveValue('nuevo');
  // Move the new one first: the published one is now where the new one was.
  await user.click(within(list).getByRole('button', { name: 'Subir Nuevo' }));
  await user.click(within(list).getByRole('button', { name: /^Nuevo/, expanded: false }));
  await user.click(within(list).getByRole('button', { name: /^Doble polvo/, expanded: false }));
  const names = within(list).getAllByLabelText('Nombre');
  await user.type(names.at(-1)!, ' x');
  // The published id is shown, not editable, and never follows its name.
  expect(within(list).getByText('finde')).toBeInTheDocument();
  // Its dates use the game's own calendar.
  expect(within(list).getAllByRole('button', { name: copy.picker.openTime }).length).toBeGreaterThanOrEqual(2);
  expect(within(list).getAllByLabelText('Identificador')).toHaveLength(1);
  await user.type(names[0]!, 'r');
  expect(within(list).getByLabelText('Identificador')).toHaveValue('nuevor');
});

test('el álbum se escribe en su porcentaje de 1 a 100, sin multiplicar', async () => {
  api({ 'GET /galaxy/api/admin/config/catalog/versions': () => jsonResponse(200, []) });
  renderAt('/admin/configuracion/catalog', { '/admin/configuracion/:key': <ConfigKeyScreen /> });
  const user = userEvent.setup();
  const list = await screen.findByRole('region', { name: 'Premios del álbum' });
  const first = parseConfig('catalog', {}).rewards[0]!;
  await user.click(within(list).getAllByRole('button', { expanded: false })[0]!);
  expect(within(list).getByLabelText('Al completar el')).toHaveValue(String(first.percent));
});
