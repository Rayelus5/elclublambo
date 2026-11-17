import type { MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { PackLibraryScreen } from '../src/admin/mail/PackLibraryScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The pack library (mail v2, P4; the owner: «biblioteca de packs»): the packs the panel reuses in any message, each
// with a name, an art, what it gives and whether it is on, made and changed visually. Since 2026-11-17 (the owner: a
// draft published apart got lost on reload) every change publishes the `mail` key at once, with its version, a reason
// and the password: saving a pack, removing a pack or a template, and the warning days.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.packs;
const g = copy.gifts;
const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['admin'], mfa: true, level: 30 };
const live = {
  packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'parcel', enabled: true, items: [{ kind: 'currency', currency: 'coins', amount: 500 }] }],
  templates: [{ id: 'caida', name: 'Caída del servidor', type: 'compensation', title: 'Perdón', body: 'Aquí tienes algo', items: [], packs: ['bienvenida'], expiresInDays: 14 }],
  warnDays: 3,
};
const posted = (fetch: ReturnType<typeof mockApi>) =>
  fetch.mock.calls.filter(([u, init]) => u === '/galaxy/api/admin/config/mail' && init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
const routes = (extra = {}) => ({
  'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
  'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, [{ key: 'mail', version: 4, data: live, createdAt: null, author: null, note: null }]),
  'GET /galaxy/api/content': () => jsonResponse(503, { error: 'internal' }),
  'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, {}),
  ...extra,
});
const open = () => renderAt('/admin/configuracion/mail', { '/admin/configuracion/mail': <PackLibraryScreen /> });

test('la biblioteca enseña cada pack con su contenido', async () => {
  mockApi(routes());
  open();
  const card = (await screen.findByRole('heading', { name: 'Bienvenida' })).closest('li')!;
  expect(within(card).getByText(g.packItems(1))).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: t.editOf('Bienvenida') })).toBeInTheDocument();
});

/** The reason and the password of the publish form inside `box`, then its button. */
async function publishIn(box: HTMLElement, button: string, reason = 'Cambio en la biblioteca') {
  await userEvent.type(within(box).getByLabelText(copy.admin.fields.reason), reason);
  await userEvent.type(within(box).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(within(box).getByRole('button', { name: button }));
}

test('un pack nuevo se publica al guardarlo: la clave entera con su versión, y sale en la biblioteca', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(201, { version: 5 }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.create }));
  const editor = screen.getByRole('region', { name: t.editorTitle });
  await userEvent.type(within(editor).getByLabelText(t.name), 'Veterano del vacío');
  expect(within(editor).getByLabelText(t.id)).toHaveValue('veterano-del-vacio');
  await userEvent.click(within(editor).getByRole('radio', { name: t.arts.chest }));
  await userEvent.type(within(editor).getByLabelText(copy.admin.fields.reason), 'Pack para veteranos');
  await userEvent.type(within(editor).getByLabelText(copy.admin.fields.password), 'mi-clave');
  // Not before it gives something.
  expect(within(editor).getByRole('button', { name: t.save })).toBeDisabled();
  await userEvent.type(within(editor).getByLabelText(g.amountOf(g.currency.dust)), '300');
  await userEvent.click(within(editor).getByRole('button', { name: g.addOf(g.currency.dust) }));
  await userEvent.click(within(editor).getByRole('button', { name: t.save }));
  await waitFor(() =>
    expect(posted(fetch)).toEqual([
      {
        data: { ...live, packs: [live.packs[0], { id: 'veterano-del-vacio', name: 'Veterano del vacío', art: 'chest', enabled: true, items: [{ kind: 'currency', currency: 'dust', amount: 300 }] }] },
        baseVersion: 4,
        reason: 'Pack para veteranos',
        password: 'mi-clave',
      },
    ]),
  );
  // Saved: the editor closes and says so. Nothing is left waiting to be published.
  expect(await screen.findByText(t.published(5))).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: t.editorTitle })).toBeNull();
});

test('un pack se apaga sin borrarlo, su identificador no cambia, y se publica al guardar', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(201, { version: 5 }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.editOf('Bienvenida') }));
  const editor = screen.getByRole('region', { name: t.editorTitle });
  expect(within(editor).getByLabelText(t.id)).toHaveAttribute('readonly');
  await userEvent.click(within(editor).getByRole('switch', { name: t.enabled }));
  await publishIn(editor, t.save, 'Fuera de temporada');
  await waitFor(() => expect(posted(fetch)).toEqual([expect.objectContaining({ baseVersion: 4, reason: 'Fuera de temporada', data: expect.objectContaining({ packs: [{ ...live.packs[0], enabled: false }] }) })]));
});

test('si la publicación falla, el editor sigue abierto con lo escrito y dice por qué', async () => {
  mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(403, { error: 'invalid_credentials' }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.editOf('Bienvenida') }));
  const editor = screen.getByRole('region', { name: t.editorTitle });
  await userEvent.clear(within(editor).getByLabelText(t.name));
  await userEvent.type(within(editor).getByLabelText(t.name), 'Bienvenida a la beta');
  await publishIn(editor, t.save);
  expect(await within(editor).findByRole('alert')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.editorTitle })).getByLabelText(t.name)).toHaveValue('Bienvenida a la beta');
});

test('si otro admin publicó antes, lo dice; al cargar lo publicado, guardar otra vez parte de su versión sin pisarla', async () => {
  let version = 4;
  let data = live;
  const fetch = mockApi(
    routes({
      'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, [{ key: 'mail', version, data, createdAt: null, author: null, note: null }]),
      'POST /galaxy/api/admin/config/mail': (b: unknown) => {
        if ((b as { baseVersion: number }).baseVersion !== version) return jsonResponse(409, { error: 'config_conflict' });
        version += 1;
        return jsonResponse(201, { version });
      },
    }),
  );
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.editOf('Bienvenida') }));
  // Meanwhile another admin publishes version 5 with a pack of their own.
  const other = { id: 'otro', name: 'Del otro admin', art: 'gift', enabled: true, items: [{ kind: 'currency', currency: 'coins', amount: 1 }] };
  data = { ...live, packs: [...live.packs, other] };
  version = 5;
  const editor = screen.getByRole('region', { name: t.editorTitle });
  await userEvent.click(within(editor).getByRole('switch', { name: t.enabled }));
  await publishIn(editor, t.save, 'Apagar');
  expect(await screen.findByText(t.moved)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: t.reload }));
  await waitFor(() => expect(screen.queryByText(t.moved)).toBeNull());
  // The editor kept the change; saving again goes on top of the other admin's version.
  await userEvent.click(within(screen.getByRole('region', { name: t.editorTitle })).getByRole('button', { name: t.save }));
  await waitFor(() => expect(posted(fetch).length).toBe(2));
  expect(posted(fetch)[1]).toMatchObject({ baseVersion: 5, data: { packs: [{ id: 'bienvenida', enabled: false }, { id: 'otro' }] } });
});

test('quitar un pack pide el motivo y la contraseña y se publica al momento', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(201, { version: 5 }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.removeOf('Bienvenida') }));
  const box = screen.getByRole('region', { name: t.removeTitle('Bienvenida') });
  await publishIn(box, t.removePublish, 'Ya no se usa');
  await waitFor(() => expect(posted(fetch)).toEqual([expect.objectContaining({ baseVersion: 4, reason: 'Ya no se usa', data: expect.objectContaining({ packs: [] }) })]));
  expect(await screen.findByText(t.published(5))).toBeInTheDocument();
});

test('las plantillas se quitan y los días de aviso se cambian, cada cosa publicada al momento; el historial sigue a mano', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(201, { version: 5 }) }));
  open();
  expect(await screen.findByRole('link', { name: t.advanced })).toHaveAttribute('href', '/admin/configuracion/mail/avanzado');
  await userEvent.click(await screen.findByRole('button', { name: t.removeTemplateOf('Caída del servidor') }));
  await publishIn(screen.getByRole('region', { name: t.removeTitle('Caída del servidor') }), t.removePublish, 'Limpieza');
  await waitFor(() => expect(posted(fetch)[0]).toMatchObject({ baseVersion: 4, data: { templates: [], warnDays: 3, packs: [{ id: 'bienvenida' }] } }));
  const days = screen.getByLabelText(t.warnDays);
  await userEvent.clear(days);
  await userEvent.type(days, '5');
  await publishIn(screen.getByRole('region', { name: t.daysBox }), t.daysSave, 'Más margen');
  await waitFor(() => expect(posted(fetch)[1]).toMatchObject({ data: { warnDays: 5 } }));
});
