import { DEFAULT_CONTENT, type HudSnapshot } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { CoopCards } from '../../src/coop/CoopHud';
import '../../src/styles/app.css';

// The co-op level-up strip with what each card does (Nov plan A1): three cards over the running world, their text
// clamped, never wider than the card nor taller than a third of the screen. VITE_COOP_SHOTS=1 saves screenshots.
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const hud = {
  offer: [
    { kind: 'evolve', id: 'pulse-storm', level: 1 },
    { kind: 'weapon', id: 'beam', level: 1 },
    { kind: 'passive', id: 'armor', level: 3 },
  ],
  coop: { offerSeq: 3, pickLeft: 7 },
} as unknown as HudSnapshot;

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`las cartas de grupo con su descripción caben a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.className = 'coop-arena';
    host.style.position = 'relative';
    host.style.width = '100vw';
    host.style.height = '100vh';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(CoopCards, { hud, content: DEFAULT_CONTENT, pickSeconds: 10, onPick: () => {} }));
    await new Promise((r) => setTimeout(r, 500));
    const strip = document.querySelector<HTMLElement>('.coop-cards')!;
    expect(strip.getBoundingClientRect().height).toBeLessThanOrEqual(height * 0.34);
    const cards = [...document.querySelectorAll<HTMLElement>('.coop-card')];
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.scrollWidth).toBeLessThanOrEqual(c.clientWidth + 1);
      expect(c.querySelector('.coop-card-desc')!.textContent!.length).toBeGreaterThan(10);
    }
    if (import.meta.env['VITE_COOP_SHOTS']) await page.screenshot({ path: `__shots__/coop-cards-${width}.png` });
  });
}
