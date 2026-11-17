import type { MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { GACHA_KEY } from '../../src/api/economy';
import { SettingsScreen } from '../../src/hub/SettingsScreen';
import { TitleScreen } from '../../src/hub/TitleScreen';
import { resetInstall, watchInstall } from '../../src/pwa/install';
import '../../src/styles/app.css';

// The installable app in a real Chromium (galaxysurvivor.es plan, PR 3): Ajustes › Pantalla with «Instalar el juego»
// and «Pantalla completa», and the install pill at the end of the title screen's foot, with the shop open too (the
// widest foot), at the usual desktop sizes and with no sideways scroll. VITE_INSTALL_SHOTS=1 saves screenshots.

const SIZES = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const;
const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 3 };
const shots = Boolean(import.meta.env['VITE_INSTALL_SHOTS']);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let root: Root | null = null;
let stop: () => void = () => {};
beforeEach(() => {
  resetInstall();
  stop = watchInstall(window);
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/galaxy/manifest.webmanifest';
  document.head.append(link);
  localStorage.clear();
});
afterEach(() => {
  stop();
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('link[rel="manifest"]').forEach((l) => l.remove());
  document.body.classList.remove('ready', 'settled');
  vi.unstubAllGlobals();
});

function offerInstall() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: 'dismissed' });
  window.dispatchEvent(event);
}

function mount(path: string, element: ReturnType<typeof createElement>, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element }))),
      ),
    ),
  );
}

for (const [w, h] of SIZES) {
  test(`Ajustes › Pantalla con instalar y pantalla completa cabe a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    offerInstall();
    mount('/ajustes?seccion=pantalla', createElement(SettingsScreen));
    await wait(400);
    const shell = document.querySelector<HTMLElement>('.settings-shell')!;
    const box = shell.getBoundingClientRect();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const rows = [...shell.querySelectorAll<HTMLElement>('.setting')];
    const install = rows.find((r) => r.textContent?.includes('Instalar el juego'))!;
    const full = rows.find((r) => r.textContent?.includes('Pantalla completa'))!;
    expect(install.querySelector('button')!.textContent).toBe('Instalar');
    expect(full.querySelector('[role="switch"]')).not.toBeNull();
    for (const row of [install, full]) {
      const r = row.getBoundingClientRect();
      expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
      expect(row.querySelector<HTMLElement>('.setting-control')!.getBoundingClientRect().right).toBeLessThanOrEqual(r.right + 0.5);
    }
    if (shots) await page.screenshot({ path: `__shots__/install-settings-${w}.png`, element: shell });
  }, 30_000);

  for (const shop of [false, true]) {
    test(`la píldora de instalar cabe en una línea al final del pie${shop ? ', con la tienda abierta,' : ''} a ${w}×${h}`, async () => {
      await page.viewport(w, h);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(GACHA_KEY, { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 1250, dust: 300, signal: 2 }, shop: { open: shop, offer: shop } });
      mount('/', createElement(TitleScreen, { me }), client);
      offerInstall();
      document.body.classList.add('ready', 'settled');
      await wait(600);
      const foot = document.querySelector<HTMLElement>('.hub-foot')!;
      const pill = foot.querySelector<HTMLElement>('.hub-install')!;
      const [go, hide] = [...pill.querySelectorAll<HTMLElement>('button')];
      const menu = document.querySelector<HTMLElement>('.menu')!.getBoundingClientRect();
      // One line: every pill of the foot on the same row, the install one too, inside the menu's column.
      const tops = [...foot.querySelectorAll<HTMLElement>(':scope > .pill, .hub-install-go')].map((p) => Math.round(p.getBoundingClientRect().top));
      expect(new Set(tops).size, tops.join(',')).toBe(1);
      expect(hide!.getBoundingClientRect().right).toBeLessThanOrEqual(menu.right + 0.5);
      expect(Math.abs(go!.getBoundingClientRect().height - foot.querySelector<HTMLElement>('.pill')!.getBoundingClientRect().height)).toBeLessThan(1);
      // «Instalar» when there is room; the icon alone (still named) beside the shop.
      const label = go!.querySelector<HTMLElement>('.hub-install-label')!;
      expect(getComputedStyle(label).display === 'none', `label at ${w}`).toBe(shop);
      expect(go!.getAttribute('aria-label')).toBe('Instalar el juego');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      if (shots) {
        await page.screenshot({ path: `__shots__/install-pill-foot-${shop ? 'tienda-' : ''}${w}.png`, element: document.querySelector<HTMLElement>('.menu')! });
        if (!shop) await page.screenshot({ path: `__shots__/install-pill-${w}.png` });
      }
    }, 30_000);
  }
}

test('las otras dos caras de la fila: ya instalada y cómo instalarla', async () => {
  await page.viewport(1600, 900);
  // No offer: where Chrome and Edge keep their icon.
  mount('/ajustes?seccion=pantalla', createElement(SettingsScreen));
  await wait(300);
  expect(document.querySelector('.settings-shell')!.textContent).toContain('barra de direcciones');
  if (shots) await page.screenshot({ path: '__shots__/install-settings-how.png', element: document.querySelector<HTMLElement>('.settings-shell')! });
  root!.unmount();
  root = null;
  document.body.innerHTML = '';
  // Installed during this visit.
  offerInstall();
  window.dispatchEvent(new Event('appinstalled'));
  mount('/ajustes?seccion=pantalla', createElement(SettingsScreen));
  await wait(300);
  const status = document.querySelector<HTMLElement>('.setting-status')!;
  expect(status.textContent).toBe('Ya la tienes instalada');
  expect(status.getBoundingClientRect().height).toBeLessThan(40);
  if (shots) await page.screenshot({ path: '__shots__/install-settings-done.png', element: document.querySelector<HTMLElement>('.settings-shell')! });
}, 30_000);
