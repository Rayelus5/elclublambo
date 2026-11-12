import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { PauseMenu } from '../../src/arena/hud/PauseMenu';
import { SettingsScreen } from '../../src/hub/SettingsScreen';
import { SETTINGS_TABS } from '../../src/settings/SettingsPanel';
import { startSync } from '../../src/settings/sync';
import '../../src/styles/app.css';

// The redesigned settings in a real browser (plan «escáner pro», part A): every tab fits the screen at the usual
// desktop sizes with no sideways scroll, the controls draw with the game's own look, and the pause's settings fit a
// 1280×720 screen with no scrollbar. VITE_SETTINGS_SHOTS=1 saves a screenshot of each tab and of the pause.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mount(path: string, element: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element }))),
      ),
    ),
  );
}

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`cada pestaña de Ajustes cabe y se ve con sus controles a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    for (const tab of SETTINGS_TABS) {
      mount(`/ajustes?seccion=${tab}`, createElement(SettingsScreen));
      await wait(400);
      const shell = document.querySelector<HTMLElement>('.settings-shell')!;
      const box = shell.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(w);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      for (const row of shell.querySelectorAll<HTMLElement>('.setting')) {
        const r = row.getBoundingClientRect();
        expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
        const control = row.querySelector<HTMLElement>('.setting-control')!.getBoundingClientRect();
        expect(control.right).toBeLessThanOrEqual(r.right + 0.5);
      }
      if (tab === 'sonido') {
        // The slider is drawn by the game (no native look) and its knob sits where the value says.
        const input = shell.querySelector<HTMLInputElement>('.slider-input')!;
        expect(getComputedStyle(input).appearance).toBe('none');
        const sw = shell.querySelector<HTMLElement>('.switch')!.getBoundingClientRect();
        expect(Math.round(sw.width)).toBe(62);
      }
      if (import.meta.env['VITE_SETTINGS_SHOTS'] && w === 1600) await page.screenshot({ path: `__shots__/settings-${tab}.png`, element: shell });
      root!.unmount();
      root = null;
      document.body.innerHTML = '';
    }
  }, 60_000);
}

test('los ajustes de la pausa caben sin barra en 1280×720', async () => {
  await page.viewport(1280, 720);
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  mount('/', createElement(PauseMenu, { manualAim: false, onManualAim: () => {}, onResume: () => {}, onAbandon: () => {} }));
  await wait(200);
  (document.querySelector<HTMLButtonElement>('.pause-actions .lip.pill:nth-child(2)')!).click();
  await wait(400);
  for (const tab of SETTINGS_TABS) {
    [...document.querySelectorAll<HTMLButtonElement>('.settings-tab')][SETTINGS_TABS.indexOf(tab)]!.click();
    await wait(350);
    const modal = document.querySelector<HTMLElement>('.modal.pause-settings')!;
    const r = modal.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(720);
    expect(modal.scrollHeight).toBeLessThanOrEqual(modal.clientHeight + 1);
    if (import.meta.env['VITE_SETTINGS_SHOTS'] && (tab === 'sonido' || tab === 'ayuda')) await page.screenshot({ path: `__shots__/settings-pause-${tab}.png`, element: modal });
  }
}, 60_000);

// Plan «ajustes en la cuenta»: the line saying the settings are kept on the account sits at the header's end, on one
// line, without pushing anything sideways. VITE_SETTINGS_SHOTS=1 saves it.
for (const [w, h] of [
  [1280, 720],
  [390, 844],
] as const) {
  test(`«Guardados en tu cuenta» cabe en la cabecera de Ajustes a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const stop = startSync({ load: async () => ({ settings: { v: 1 }, updatedAt: null }), save: async () => ({}) });
    try {
      mount('/ajustes', createElement(SettingsScreen));
      await wait(400);
      const note = document.querySelector<HTMLElement>('.settings-sync')!;
      expect(note.textContent).toBe('Guardados en tu cuenta');
      const box = note.getBoundingClientRect();
      expect(box.right).toBeLessThanOrEqual(w);
      expect(box.height).toBeLessThan(30);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      if (import.meta.env['VITE_SETTINGS_SHOTS']) await page.screenshot({ path: `__shots__/settings-sync-${w}.png` });
    } finally {
      stop();
    }
  });
}
