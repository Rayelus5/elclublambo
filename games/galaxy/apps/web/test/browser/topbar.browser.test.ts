import type { MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FRIENDS_KEY } from '../../src/api/friends';
import { TopBar } from '../../src/hub/TopBar';
import '../../src/styles/app.css';

// The top bar's player pill (Nov plan C2 follow-up): the square avatar's face fills the pill's whole height at its left
// end, whose corners are square like the avatar's, and its frame sticks out round the pill (owner, 2026-11-12); the
// right end stays round; no staff badge. With VITE_TOPBAR_SHOTS=1 it saves screenshots.

const wallet = { coins: 1840, dust: 64, signal: 6, components: 22, material: 0 };
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.body.classList.remove('ready', 'settled');
  vi.unstubAllGlobals();
});

for (const [label, frame] of [
  ['con marco', 'prism'],
  ['sin marco', null],
] as const) {
  test(`la pastilla del jugador ${label}: el avatar llena su alto a la izquierda, esquinas rectas a ese lado`, async () => {
    await page.viewport(1600, 900);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    // The hub's entrance has played (its .enter pieces sit in place).
    document.body.classList.add('ready', 'settled');
    const me: MeResponse = { id: 'a1', username: 'vega', roles: ['superadmin'], mfa: true, level: 17, avatar: 'crew-cat', frame };
    const host = document.createElement('div');
    host.style.cssText = 'padding:24px';
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(TopBar, { me, wallet, freePull: false })))));
    await new Promise((r) => setTimeout(r, 600));
    const pill = host.querySelector<HTMLElement>('.hud .me')!.closest<HTMLElement>('.hud')!;
    const box = pill.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(pill).borderTopWidth);
    const face = pill.querySelector<HTMLElement>('.avatar-box')!.getBoundingClientRect();
    // The face spans the pill inside its border, from its left edge.
    expect(Math.abs(face.top - (box.top + border))).toBeLessThan(1.5);
    expect(Math.abs(face.bottom - (box.bottom - border))).toBeLessThan(1.5);
    expect(Math.abs(face.left - (box.left + border))).toBeLessThan(1.5);
    // Its frame sticks out above and below the pill.
    if (frame) {
      const ring = pill.querySelector<HTMLElement>('.avatar-frame')!.getBoundingClientRect();
      expect(ring.top).toBeLessThan(box.top - 4);
      expect(ring.bottom).toBeGreaterThan(box.bottom + 4);
    }
    // Square on the avatar's side, round on the other.
    const style = getComputedStyle(pill);
    expect(parseFloat(style.borderTopLeftRadius)).toBeLessThanOrEqual(12);
    expect(parseFloat(style.borderTopRightRadius)).toBeGreaterThanOrEqual(box.height / 2);
    expect(pill.querySelector('.badge-admin')).toBeNull();
    if (import.meta.env['VITE_TOPBAR_SHOTS']) await page.screenshot({ path: `__shots__/topbar-${frame ?? 'none'}.png`, element: host });
  }, 30_000);
}

// The friends button (owner, 2026-11-12): how many friends are online is a green count; when the bar folds its
// shortcuts down to their icon, it sits on the button's top-right corner, clear of the icon, as Noticias' does; a
// request's dot then drops to the bottom-right corner. With the name shown it follows the name, as before.
const friend = (username: string) => ({ username, level: 3, clan: null, presence: { status: 'online', activity: 'hub' } as const, since: '2026-11-10T10:00:00Z', avatar: null, frame: null });
for (const [w, folded] of [
  [1440, true],
  [1920, false],
] as const) {
  test(`el número de amigos conectados a ${w} de ancho ${folded ? 'va en la esquina, sin tapar el icono' : 'sigue al nombre'}`, async () => {
    await page.viewport(w, 900);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    document.body.classList.add('ready', 'settled');
    const me: MeResponse = { id: 'a1', username: 'vega', roles: [], mfa: false, level: 17, avatar: 'crew-cat', frame: null };
    const client = new QueryClient();
    client.setQueryData(FRIENDS_KEY, {
      friends: [friend('lyra'), friend('orion'), friend('altair')],
      incoming: [{ username: 'deneb', level: 2, at: '2026-11-12T10:00:00Z' }],
      outgoing: [],
      blocked: [],
      prefs: { invites: 'friends', showStatus: true, notices: 'sound' },
      max: 100,
    });
    const host = document.createElement('div');
    host.style.cssText = 'padding:24px';
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(TopBar, { me, wallet, freePull: false })))));
    await new Promise((r) => setTimeout(r, 600));
    const button = host.querySelector<HTMLElement>('.friends-button')!;
    const box = button.getBoundingClientRect();
    const icon = button.querySelector<HTMLElement>('.ico, svg')!.getBoundingClientRect();
    const count = button.querySelector<HTMLElement>('.friends-online')!.getBoundingClientRect();
    const dot = button.querySelector<HTMLElement>('.friends-request')!.getBoundingClientRect();
    const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    expect(button.querySelector('.friends-online')!.textContent).toBe('3');
    if (folded) {
      expect(box.width).toBeLessThan(56);
      expect(overlap(count, icon)).toBe(false);
      // On the top-right corner: its centre beyond the button's middle, right and up, sticking out a little.
      expect(count.left + count.width / 2).toBeGreaterThan(box.left + box.width * 0.75);
      expect(count.top + count.height / 2).toBeLessThan(box.top + box.height * 0.25);
      expect(overlap(count, dot)).toBe(false);
    } else {
      const name = button.querySelector<HTMLElement>('.label')!.getBoundingClientRect();
      expect(count.left).toBeGreaterThanOrEqual(name.right - 1);
      expect(Math.abs(count.top + count.height / 2 - (box.top + box.height / 2))).toBeLessThan(4);
    }
    if (import.meta.env['VITE_TOPBAR_SHOTS']) await page.screenshot({ path: `__shots__/topbar-friends-${w}.png`, element: host });
  }, 30_000);
}
