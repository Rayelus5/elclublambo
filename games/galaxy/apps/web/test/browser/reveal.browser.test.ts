import { renderFromSeed } from '@galaxy/engine';
import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { RevealStage } from '../../src/scanner/RevealStage';
import '../../src/styles/app.css';

// The scan's reveal in a real Chromium: the featured galaxy's sign, the card's beams and the burst animate over the
// screen, yet the popup never grows scrollbars (the beams turning behind an epic or legendary card used to grow them).
// VITE_REVEAL_SHOTS=1 also saves screenshots for review.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const pulled = (tier: Tier): PulledGalaxy =>
  ({
    id: `g-${tier}`,
    seed: '9000017',
    tier,
    finish: 'holo',
    traits: renderFromSeed(9_000_017n, { columns: 48 }).traits as unknown as Record<string, string>,
    name: 'Kathra',
    designation: 'GX-00F7A1',
    featured: true,
    level: 1,
    createdAt: '2026-11-10T20:00:00Z',
  }) as PulledGalaxy;

const until = async (check: () => boolean, ms = 30_000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};

for (const [tier, width, height] of [
  ['uncommon', 1280, 720],
  ['epic', 1366, 768],
  ['legendary', 1280, 720],
  ['legendary', 1920, 1080],
] as const) {
  test(`una destacada ${tier} a ${width}×${height}: el popup no saca barras de desplazamiento`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(RevealStage, { pulls: [pulled(tier)], onClose: () => {} }));
    await until(() => document.querySelector('.stage-next') !== null);
    // Seguir jumps from inside the pull to its card.
    (document.querySelector('.stage-next') as HTMLButtonElement).click();
    await until(() => document.querySelector('.stage-featured') !== null);
    const modal = document.querySelector('.modal.reveal-stage') as HTMLElement;
    const overflowed: string[] = [];
    // The sign lands after .35 s and bounces for .55 s; the beams keep turning.
    const start = performance.now();
    while (performance.now() - start < 1800) {
      // Scrollbars: the popup scrolls (auto) and its content does not fit.
      const { overflowX, overflowY } = getComputedStyle(modal);
      const scrolls = (o: string) => o === 'auto' || o === 'scroll';
      if ((scrolls(overflowX) && modal.scrollWidth > modal.clientWidth) || (scrolls(overflowY) && modal.scrollHeight > modal.clientHeight)) {
        overflowed.push(`${Math.round(performance.now() - start)}ms ${modal.scrollWidth}×${modal.scrollHeight} > ${modal.clientWidth}×${modal.clientHeight}`);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/reveal-${tier}-${width}.png` });
    expect(overflowed).toEqual([]);
  }, 60_000);
}
