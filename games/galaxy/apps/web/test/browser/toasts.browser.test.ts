import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { type LiveToast, useLive } from '../../src/live/LiveConnection';
import { NoticeModeField } from '../../src/live/NoticeMode';
import { LiveToasts } from '../../src/live/Toasts';
import '../../src/styles/app.css';

// The live toasts in a real browser (real-time notices plan, 2026-11-12): at the top centre, under the top bar, above
// an open window, inside the screen at every width. VITE_TOAST_SHOTS=1 saves a screenshot of each kind.

vi.mock('../../src/live/sfx', () => ({ playNotice: () => {} }));

const vega = { username: 'vega', avatar: 'crew-cat', frame: 'prism' };
const KINDS: LiveToast[][] = [
  [
    { id: 1, kind: 'notice', username: '', notice: { kind: 'trade', event: 'proposed', trade: 't1', from: vega } },
    { id: 2, kind: 'notice', username: '', notice: { kind: 'sale', listing: 'l1', galaxy: { id: 'g1', name: 'Kathra', tier: 'rare' }, price: 600, net: 558, buyer: { username: 'lyra' }, wallet: { coins: 1, dust: 0, signal: 0 } } },
    { id: 3, kind: 'request', username: 'orion' },
  ],
  [
    { id: 4, kind: 'notice', username: '', notice: { kind: 'achievement', id: 'a1', name: 'Purgador de la Estática', tier: 'gold' } },
    { id: 5, kind: 'notice', username: '', notice: { kind: 'clan', event: 'request', clan: { tag: 'NEB', name: 'Nebulosa Roja' }, who: vega } },
    { id: 6, kind: 'kicked', username: '' },
  ],
  [
    { id: 7, kind: 'notice', username: '', notice: { kind: 'mail', id: 'm1', title: 'Gracias por jugar la beta: un regalo de bienvenida' } },
    { id: 8, kind: 'notice', username: '', notice: { kind: 'trade', event: 'cancelled', trade: 't2', from: { username: 'deneb_de_la_nebulosa_larga' } } },
    { id: 9, kind: 'notice', username: '', notice: { kind: 'clan', event: 'promoted', clan: { tag: 'NEB', name: 'Nebulosa Roja' }, who: vega } },
  ],
];

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  useLive.setState({ toasts: [], run: null });
  vi.unstubAllGlobals();
});

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
] as const) {
  test(`los avisos, arriba en el centro y por encima de una ventana, a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    // An open window behind them (the overlay every Dialog uses).
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.append(overlay);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    for (const [set, toasts] of KINDS.entries()) {
      flushSync(() => useLive.setState({ toasts }));
      flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(LiveToasts)))));
      await new Promise((r) => setTimeout(r, 650));
      const list = document.querySelector<HTMLElement>('.live-toasts')!;
      const box = list.getBoundingClientRect();
      expect(Math.abs(box.left + box.width / 2 - w / 2)).toBeLessThan(2);
      expect(box.top).toBeGreaterThanOrEqual(80);
      expect(box.top).toBeLessThan(120);
      expect(Number(getComputedStyle(list).zIndex)).toBeGreaterThan(Number(getComputedStyle(overlay).zIndex));
      for (const li of list.querySelectorAll('li')) {
        const r = li.getBoundingClientRect();
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(w);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
      if (import.meta.env['VITE_TOAST_SHOTS'] && w === 1600) await page.screenshot({ path: `__shots__/toasts-${set + 1}.png`, element: list });
    }
  }, 30_000);
}

test('el modo de avisos junto a «Personalizar», en una fila', async () => {
  await page.viewport(1280, 720);
  const view = { friends: [], incoming: [], outgoing: [], blocked: [], prefs: { invites: 'friends', showStatus: true, notices: 'silent' }, max: 200 };
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(view), { status: 200, headers: { 'content-type': 'application/json' } }));
  const host = document.createElement('div');
  host.className = 'profile-actions';
  host.style.cssText = 'padding:16px';
  host.innerHTML = '<button type="button" class="lip pill pill-uv">Personalizar</button>';
  document.body.append(host);
  const slot = document.createElement('div');
  slot.style.display = 'contents';
  host.append(slot);
  root = createRoot(slot);
  flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(NoticeModeField)))));
  const select = await vi.waitFor(() => {
    const el = host.querySelector<HTMLElement>('.notice-mode .select');
    if (!el) throw new Error('aún no');
    return el;
  });
  const button = host.querySelector('button')!.getBoundingClientRect();
  expect(Math.abs(select.getBoundingClientRect().top + select.getBoundingClientRect().height / 2 - (button.top + button.height / 2))).toBeLessThan(6);
  if (import.meta.env['VITE_TOAST_SHOTS']) await page.screenshot({ path: '__shots__/notice-mode.png', element: host });
});
