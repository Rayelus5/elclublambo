import type { ReleaseNotesView, SettingsView } from '@galaxy/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { MainMenu } from '../src/hub/MainMenu';
import { NotesScreen } from '../src/notes/NotesScreen';
import { getPrefs, resetPrefs, setPrefs } from '../src/settings/prefs';
import { startSync } from '../src/settings/sync';
import { jsonResponse, mockApi, renderAt } from './render';

// «Notas de versión» for the players (plan «notas de versión»): a pill in the home menu's foot, marked «Nuevo» while a
// version is unseen; the page lists every version (newest first) with its date, summary and changes by kind, an
// index that links to each, and opening it counts the newest as seen (kept with the settings, on the account).

afterEach(() => {
  vi.unstubAllGlobals();
  resetPrefs();
  localStorage.clear();
});

const view: ReleaseNotesView = {
  notes: [
    { id: 'v1-2-segunda', version: '1.2', date: '2026-11-11', title: 'Segunda', summary: 'Lo de la segunda', items: [{ kind: 'nuevo', text: 'Cosa nueva' }, { kind: 'arreglo', text: 'Algo arreglado' }] },
    { id: 'v1-1-primera', version: '1.1', date: '2026-11-10', title: 'Primera', summary: '', items: [{ kind: 'mejora', text: 'Algo mejor' }] },
  ],
};
const t = copy.notes;

test('el pie del menú lleva a las notas de versión y dice «Nuevo» mientras haya una sin ver', async () => {
  setPrefs({ notesSeen: '1.1' });
  mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(200, view) });
  renderAt('/', { '/': <MainMenu galaxies={3} /> });
  const link = await screen.findByRole('link', { name: copy.hub.notesFresh });
  expect(link).toHaveAttribute('href', '/notas-de-version');
  expect(within(link).getByText(copy.hub.notesNew)).toBeInTheDocument();
});

test('con todo visto, el botón no lleva aviso', async () => {
  setPrefs({ notesSeen: '1.2' });
  mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(200, view) });
  renderAt('/', { '/': <MainMenu galaxies={3} /> });
  const link = await screen.findByRole('link', { name: copy.hub.notes });
  await new Promise((r) => setTimeout(r, 20));
  expect(within(link).queryByText(copy.hub.notesNew)).toBeNull();
});

test('la página enseña cada versión con su fecha, su resumen y sus cambios por tipo, y da por vista la última', async () => {
  setPrefs({ notesSeen: '1.1' });
  mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(200, view) });
  renderAt('/notas-de-version', { '/notas-de-version': <NotesScreen /> });
  expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
  const second = await screen.findByRole('article', { name: 'Segunda' });
  expect(within(second).getByText(t.version('1.2'))).toBeInTheDocument();
  expect(within(second).getByText('11 de noviembre de 2026')).toBeInTheDocument();
  expect(within(second).getByText('Lo de la segunda')).toBeInTheDocument();
  expect(within(second).getByRole('heading', { name: t.kinds.nuevo })).toBeInTheDocument();
  expect(within(second).getByRole('heading', { name: t.kinds.arreglo })).toBeInTheDocument();
  expect(within(second).queryByRole('heading', { name: t.kinds.mejora })).toBeNull();
  expect(within(second).getByText('Cosa nueva')).toBeInTheDocument();
  expect(within(second).getByText(t.fresh)).toBeInTheDocument();
  const first = screen.getByRole('article', { name: 'Primera' });
  expect(within(first).queryByText(t.fresh)).toBeNull();
  const index = screen.getByRole('navigation', { name: t.index });
  expect(within(index).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/notas-de-version?version=1.2', '/notas-de-version?version=1.1']);
  await waitFor(() => expect(getPrefs().notesSeen).toBe('1.2'));
});

test('un enlace directo a una versión la trae a la vista', async () => {
  const scrolled = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scrolled;
  try {
    mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(200, view) });
    renderAt('/notas-de-version?version=1.1', { '/notas-de-version': <NotesScreen /> });
    const first = await screen.findByRole('article', { name: 'Primera' });
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled.mock.contexts.at(-1)).toBe(first);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('si no se pueden cargar, lo dice', async () => {
  mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(500, { error: 'internal' }) });
  renderAt('/notas-de-version', { '/notas-de-version': <NotesScreen /> });
  expect(await screen.findByText(t.error)).toBeInTheDocument();
});

test('en un dispositivo nuevo, espera a la cuenta para saber qué es nuevo y no marca nada antes', async () => {
  let answer: (v: SettingsView) => void = () => {};
  const stop = startSync({ load: () => new Promise<SettingsView>((r) => (answer = r)), save: async () => ({}) });
  try {
    mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(200, view) });
    renderAt('/notas-de-version', { '/notas-de-version': <NotesScreen /> });
    await screen.findByRole('article', { name: 'Segunda' });
    await new Promise((r) => setTimeout(r, 30));
    // Not yet: the account may already have seen them.
    expect(screen.queryByText(t.fresh)).toBeNull();
    expect(getPrefs().notesSeen).toBeNull();
    await act(async () => answer({ settings: { v: 1, notesSeen: '1.1' }, updatedAt: null }));
    const second = screen.getByRole('article', { name: 'Segunda' });
    expect(await within(second).findByText(t.fresh)).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Primera' })).queryByText(t.fresh)).toBeNull();
    await waitFor(() => expect(getPrefs().notesSeen).toBe('1.2'));
  } finally {
    stop();
  }
});

test('dos notas con la misma versión no se pisan en la página', async () => {
  mockApi({ 'GET /galaxy/api/notes': () => jsonResponse(200, { notes: [view.notes[0]!, { ...view.notes[0]!, id: 'v1-2-del-panel', title: 'Del panel' }] }) });
  renderAt('/notas-de-version', { '/notas-de-version': <NotesScreen /> });
  const [a, b] = await screen.findAllByRole('article');
  expect(a!.id).not.toBe(b!.id);
});
