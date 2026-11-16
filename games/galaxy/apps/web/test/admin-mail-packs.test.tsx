import type { MeResponse } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { PackLibraryScreen } from '../src/admin/mail/PackLibraryScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The pack library (mail v2, P4; the owner: «biblioteca de packs»): the packs the panel reuses in any message, each
// with a name, an art, what it gives and whether it is on; made and changed visually, then published as the `mail`
// key with its version, a reason and the password.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.packs;
const g = copy.gifts;
const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['admin'], mfa: true, level: 30 };
const live = {
  packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'parcel', enabled: true, items: [{ kind: 'currency', currency: 'coins', amount: 500 }] }],
  templates: [],
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

test('un pack nuevo: nombre, dibujo y regalos; se publica la clave entera con su versión', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(201, { version: 5 }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.create }));
  const editor = screen.getByRole('region', { name: t.editorTitle });
  await userEvent.type(within(editor).getByLabelText(t.name), 'Veterano del vacío');
  expect(within(editor).getByLabelText(t.id)).toHaveValue('veterano-del-vacio');
  await userEvent.click(within(editor).getByRole('radio', { name: t.arts.chest }));
  const save = within(editor).getByRole('button', { name: t.save });
  expect(save).toBeDisabled();
  await userEvent.type(within(editor).getByLabelText(g.amountOf(g.currency.dust)), '300');
  await userEvent.click(within(editor).getByRole('button', { name: g.addOf(g.currency.dust) }));
  await userEvent.click(save);
  expect(await screen.findByRole('heading', { name: 'Veterano del vacío' })).toBeInTheDocument();
  expect(screen.getByText(t.pending(1))).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(copy.admin.fields.reason), 'Pack para veteranos');
  await userEvent.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(screen.getByRole('button', { name: t.publish }));
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
});

test('un pack se apaga sin borrarlo, y su identificador no cambia', async () => {
  const fetch = mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(201, { version: 5 }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.editOf('Bienvenida') }));
  const editor = screen.getByRole('region', { name: t.editorTitle });
  expect(within(editor).getByLabelText(t.id)).toHaveAttribute('readonly');
  await userEvent.click(within(editor).getByRole('switch', { name: t.enabled }));
  await userEvent.click(within(editor).getByRole('button', { name: t.save }));
  expect(await screen.findByText(g.packOff)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(copy.admin.fields.reason), 'Fuera de temporada');
  await userEvent.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(screen.getByRole('button', { name: t.publish }));
  await waitFor(() => expect(posted(fetch)[0]).toMatchObject({ data: { packs: [{ id: 'bienvenida', enabled: false }] } }));
});

test('si otro admin publicó antes, lo dice y no pisa su versión', async () => {
  mockApi(routes({ 'POST /galaxy/api/admin/config/mail': () => jsonResponse(409, { error: 'config_conflict' }) }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: t.editOf('Bienvenida') }));
  const editor = screen.getByRole('region', { name: t.editorTitle });
  await userEvent.clear(within(editor).getByLabelText(t.name));
  await userEvent.type(within(editor).getByLabelText(t.name), 'Bienvenida a la beta');
  await userEvent.click(within(editor).getByRole('button', { name: t.save }));
  await userEvent.type(screen.getByLabelText(copy.admin.fields.reason), 'Nombre nuevo');
  await userEvent.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await userEvent.click(screen.getByRole('button', { name: t.publish }));
  expect(await screen.findByRole('alert')).toHaveTextContent(String(copy.errors.config_conflict));
});
