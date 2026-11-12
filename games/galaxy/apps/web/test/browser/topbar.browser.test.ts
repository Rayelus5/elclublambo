import type { MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
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
