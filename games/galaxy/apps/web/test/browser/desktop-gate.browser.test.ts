import type { DeviceEnv } from '@galaxy/shared';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { DesktopGate } from '../../src/shell/DesktopGate';
import '../../src/styles/app.css';
import bungeeUrl from '../../public/fonts/bungee-latin.woff2?url';
import fredokaUrl from '../../public/fonts/fredoka-latin.woff2?url';

// The phone notice on real phone and tablet sizes (2026-11-27): the logo, the fleet and the card whole, nothing
// sideways, the buttons big enough for a thumb. VITE_GATE_SHOTS=1 saves screenshots.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.body.classList.remove('ready', 'settled');
});

const PHONE: DeviceEnv = {
  navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 },
  matchMedia: () => ({ matches: false }),
};

for (const [name, w, h] of [
  ['iphone', 390, 844],
  ['android-pequeno', 360, 640],
  ['horizontal', 844, 390],
  ['tablet', 820, 1180],
] as const) {
  test(`el aviso de móvil se ve entero a ${w}×${h} (${name})`, async () => {
    await page.viewport(w, h);
    for (const f of [new FontFace('Bungee', `url(${bungeeUrl})`), new FontFace('Fredoka', `url(${fredokaUrl})`, { weight: '300 700' })]) document.fonts.add(await f.load());
    document.body.style.margin = '0';
    document.body.classList.add('ready', 'settled');
    const host = document.createElement('div');
    host.style.height = '100vh';
    document.body.append(host);
    root = createRoot(host);
    root.render(createElement(DesktopGate, { win: PHONE, children: createElement('p', null, 'juego') }));
    await new Promise((r) => setTimeout(r, 900));
    const gate = document.querySelector<HTMLElement>('.gate')!;
    // Nothing sideways.
    expect(gate.scrollWidth).toBeLessThanOrEqual(gate.clientWidth + 1);
    const card = document.querySelector<HTMLElement>('.gate-card')!.getBoundingClientRect();
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(w);
    // Big enough for a thumb.
    for (const b of document.querySelectorAll<HTMLElement>('.gate-actions .pill')) expect(b.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    // The logo's tag stays on the screen.
    const tag = document.querySelector<HTMLElement>('.gate .logo .beta')!.getBoundingClientRect();
    expect(tag.right).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_GATE_SHOTS']) await page.screenshot({ path: `__shots__/gate-${name}.png` });
  }, 30_000);
}
