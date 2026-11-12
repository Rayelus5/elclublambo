import { RELEASE_NOTES } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { NotesAdmin } from '../../src/admin/NotesAdmin';
import { ADMIN_NOTES_KEY, NOTES_KEY } from '../../src/api/notes';
import { MainMenu } from '../../src/hub/MainMenu';
import { NotesScreen } from '../../src/notes/NotesScreen';
import { resetPrefs, setPrefs } from '../../src/settings/prefs';
import '../../src/styles/app.css';

// «Notas de versión» in a real browser (plan «notas de versión»): the page with the game's own notes fits every screen
// with no sideways scroll (the index beside the versions, or above them on a phone), the menu's foot keeps its pills
// in the menu with the new one, and the panel's editor shows the form and the preview side by side.
// VITE_NOTES_SHOTS=1 saves screenshots.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.body.classList.remove('ready', 'settled');
  vi.unstubAllGlobals();
  resetPrefs();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mount(path: string, element: ReturnType<typeof createElement>, client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  document.body.classList.add('ready', 'settled');
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element }))))));
  return client;
}
const withNotes = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(NOTES_KEY, { notes: [...RELEASE_NOTES] });
  return client;
};

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [390, 844],
] as const) {
  test(`las notas de versión caben y se leen a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    setPrefs({ notesSeen: '1.3' });
    mount('/notas-de-version', createElement(NotesScreen), withNotes());
    await wait(700);
    const entries = document.querySelectorAll<HTMLElement>('.notes-entry');
    expect(entries).toHaveLength(RELEASE_NOTES.length);
    for (const e of entries) {
      const box = e.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(w);
    }
    const index = document.querySelector<HTMLElement>('.notes-index')!.getBoundingClientRect();
    expect(index.right).toBeLessThanOrEqual(w);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_NOTES_SHOTS']) await page.screenshot({ path: `__shots__/notes-${w}.png` });
  }, 30_000);
}

test('el pie del menú con «Notas de versión» y su «Nuevo» cabe en el menú a 1280 y 1600', async () => {
  for (const w of [1280, 1600]) {
    await page.viewport(w, 800);
    mount('/', createElement(MainMenu, { galaxies: 12 }), withNotes());
    await wait(1800);
    const foot = document.querySelector<HTMLElement>('.hub-foot')!;
    const menu = document.querySelector<HTMLElement>('.menu')!.getBoundingClientRect();
    const pills = [...foot.querySelectorAll<HTMLElement>('.pill')];
    expect(pills.map((p) => p.textContent)).toContain('Notas de versiónNuevo');
    const tops = new Set(pills.map((p) => Math.round(p.getBoundingClientRect().top)));
    expect(tops.size).toBe(1);
    for (const p of pills) expect(p.getBoundingClientRect().right).toBeLessThanOrEqual(menu.right + 1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_NOTES_SHOTS']) await page.screenshot({ path: `__shots__/notes-menu-${w}.png`, element: foot.parentElement! });
    root?.unmount();
    root = null;
    document.body.innerHTML = '';
  }
}, 40_000);

test('el editor del panel enseña el formulario y la vista previa uno al lado del otro a 1600', async () => {
  await page.viewport(1600, 900);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ADMIN_NOTES_KEY, { notes: RELEASE_NOTES.map((n, i) => ({ ...n, source: i === 1 ? 'edited' : 'code', hidden: i === 2, updatedAt: null, updatedBy: null })) });
  mount('/admin/notas-de-version', createElement(NotesAdmin), client);
  await wait(300);
  (document.querySelector<HTMLButtonElement>('.notes-admin-actions button')!).click();
  await wait(500);
  const dialog = document.querySelector<HTMLElement>('.modal.notes-editor')!;
  const form = dialog.querySelector<HTMLElement>('.notes-editor-form')!.getBoundingClientRect();
  const preview = dialog.querySelector<HTMLElement>('.notes-editor-preview')!.getBoundingClientRect();
  expect(preview.left).toBeGreaterThan(form.right - 1);
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(1600);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1600);
  if (import.meta.env['VITE_NOTES_SHOTS']) await page.screenshot({ path: '__shots__/notes-editor-1600.png' });
}, 30_000);
