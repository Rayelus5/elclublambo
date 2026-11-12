import type { AdminReleaseNotesView } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { NotesAdmin } from '../src/admin/NotesAdmin';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// «Notas de versión» in the panel (plan «notas de versión»): every note with where it comes from (the game's code, the
// panel, or a correction of the code) and whether it is hidden; «Nueva nota» and «Editar» open the same editor; the
// code's notes are hidden and restored, never deleted; the panel's own are deleted after a confirmation.

afterEach(() => vi.unstubAllGlobals());
const t = copy.admin.notes;

const view: AdminReleaseNotesView = {
  notes: [
    { id: 'v1-2-del-juego', version: '1.2', date: '2026-11-11', title: 'Del juego', summary: 'Un resumen', items: [{ kind: 'nuevo', text: 'Algo nuevo' }], source: 'code', hidden: false, updatedAt: null, updatedBy: null },
    { id: 'v1-1-del-panel', version: '1.1', date: '2026-11-10', title: 'Del panel', summary: '', items: [{ kind: 'arreglo', text: 'Algo arreglado' }], source: 'panel', hidden: true, updatedAt: '2026-11-12T10:00:00Z', updatedBy: 'vega' },
  ],
};
const routes = (extra: Record<string, (body: unknown) => Response> = {}) => mockApi({ 'GET /galaxy/api/admin/notes': () => jsonResponse(200, view), ...extra });
const open = () => renderAt('/admin/notas-de-version', { '/admin/notas-de-version': <NotesAdmin /> });

test('la lista dice de dónde viene cada nota y si está oculta', async () => {
  routes();
  open();
  const table = await screen.findByRole('table', { name: t.tableTitle });
  const [game, panel] = within(table).getAllByRole('row').slice(1);
  expect(game).toHaveTextContent('1.2');
  expect(game).toHaveTextContent(t.sources.code);
  expect(panel).toHaveTextContent(t.sources.panel);
  expect(panel).toHaveTextContent(t.hidden);
  // The code's note is hidden, not deleted; the panel's hidden one is restored or deleted.
  expect(within(game!).getByRole('button', { name: t.hideOf('1.2') })).toBeInTheDocument();
  expect(within(game!).queryByRole('button', { name: t.deleteOf('1.2') })).toBeNull();
  expect(within(panel!).getByRole('button', { name: t.restoreOf('1.1') })).toBeInTheDocument();
  expect(within(panel!).getByRole('button', { name: t.deleteOf('1.1') })).toBeInTheDocument();
});

test('«Nueva nota» guarda la nota con sus cambios, con un id sacado de la versión y el título', async () => {
  let saved: unknown = null;
  const fetch = routes({
    'PUT /galaxy/api/admin/notes/v1-3-la-nota-nueva': (body) => {
      saved = body;
      return jsonResponse(200, { ...(body as object), id: 'v1-3-la-nota-nueva', source: 'panel', hidden: false, updatedAt: null, updatedBy: 'vega' });
    },
  });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.create }));
  const dialog = await screen.findByRole('dialog', { name: t.create });
  await user.clear(within(dialog).getByLabelText(t.fields.version));
  await user.type(within(dialog).getByLabelText(t.fields.version), '1.3');
  await user.type(within(dialog).getByLabelText(t.fields.title), 'La nota nueva');
  await user.type(within(dialog).getByLabelText(t.fields.summary), 'Lo que trae');
  await user.type(within(dialog).getByLabelText(t.itemText(1)), 'Una cosa nueva');
  await user.click(within(dialog).getByRole('button', { name: t.addItem }));
  await user.type(within(dialog).getByLabelText(t.itemText(2)), 'Un arreglo');
  // The preview reads as the players will see it.
  expect(within(dialog).getByRole('article', { name: 'La nota nueva' })).toHaveTextContent('Una cosa nueva');
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(saved).not.toBeNull());
  expect(saved).toMatchObject({ version: '1.3', title: 'La nota nueva', summary: 'Lo que trae', items: [{ kind: 'nuevo', text: 'Una cosa nueva' }, { kind: 'nuevo', text: 'Un arreglo' }] });
  expect((saved as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetch.mock.calls.filter(([u]) => u === '/galaxy/api/admin/notes').length).toBeGreaterThan(1);
});

test('«Editar» abre la nota tal cual y guarda la corrección en su mismo id', async () => {
  let saved: unknown = null;
  routes({
    'PUT /galaxy/api/admin/notes/v1-2-del-juego': (body) => {
      saved = body;
      return jsonResponse(200, { ...view.notes[0], ...(body as object), source: 'edited' });
    },
  });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.editOf('1.2') }));
  const dialog = await screen.findByRole('dialog', { name: t.editOf('1.2') });
  const title = within(dialog).getByLabelText(t.fields.title);
  expect(title).toHaveValue('Del juego');
  await user.clear(title);
  await user.type(title, 'Del juego corregida');
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(saved).toMatchObject({ version: '1.2', date: '2026-11-11', title: 'Del juego corregida', items: [{ kind: 'nuevo', text: 'Algo nuevo' }] }));
});

test('ocultar, restaurar y eliminar (esto último tras confirmarlo)', async () => {
  const calls: string[] = [];
  const done = (url: string) => () => {
    calls.push(url);
    return jsonResponse(200, { ok: true });
  };
  routes({
    'POST /galaxy/api/admin/notes/v1-2-del-juego/hide': done('hide'),
    'POST /galaxy/api/admin/notes/v1-1-del-panel/restore': done('restore'),
    'POST /galaxy/api/admin/notes/v1-1-del-panel/delete': done('delete'),
  });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.hideOf('1.2') }));
  await user.click(screen.getByRole('button', { name: t.restoreOf('1.1') }));
  await user.click(screen.getByRole('button', { name: t.deleteOf('1.1') }));
  const confirm = await screen.findByRole('alertdialog', { name: t.deleteOf('1.1') });
  expect(calls).toEqual(['hide', 'restore']);
  await user.click(within(confirm).getByRole('button', { name: t.delete }));
  await waitFor(() => expect(calls).toEqual(['hide', 'restore', 'delete']));
});

test('un error del servidor se ve en el editor', async () => {
  routes({ 'PUT /galaxy/api/admin/notes/v1-2-otra': () => jsonResponse(409, { error: 'note_version_taken' }) });
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: t.create }));
  const dialog = await screen.findByRole('dialog', { name: t.create });
  await user.clear(within(dialog).getByLabelText(t.fields.version));
  await user.type(within(dialog).getByLabelText(t.fields.version), '1.2');
  await user.type(within(dialog).getByLabelText(t.fields.title), 'Otra');
  await user.type(within(dialog).getByLabelText(t.itemText(1)), 'Algo');
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.note_version_taken);
});
