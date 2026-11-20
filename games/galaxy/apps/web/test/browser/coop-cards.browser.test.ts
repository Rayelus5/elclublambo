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

// The owner (2026-11-14): taking a card in a group run shows it. The pick goes at once; the card glows, lifts and flies
// towards the kit while the others fade; then the strip goes. Nothing counts in the strip's first moment.
test('al elegir una carta en grupo, brilla y vuela al kit; las demás se apagan', async () => {
  await page.viewport(1280, 720);
  document.body.style.margin = '0';
  const host = document.createElement('div');
  host.className = 'coop-arena';
  host.style.cssText = 'position:relative;width:100vw;height:100vh;background:#070a1c';
  document.body.appendChild(host);
  const kit = document.createElement('div');
  kit.className = 'hud-kit';
  kit.style.cssText = 'position:absolute;left:20px;bottom:18px;width:120px;height:44px';
  host.appendChild(kit);
  const box = document.createElement('div');
  host.appendChild(box);
  const picks: number[][] = [];
  root = createRoot(box);
  root.render(createElement(CoopCards, { hud, content: DEFAULT_CONTENT, pickSeconds: 10, onPick: (i: number, seq: number) => picks.push([i, seq]) }));
  await new Promise((r) => setTimeout(r, 100));
  // Too soon: a dash pressed as the strip opened takes nothing.
  document.querySelectorAll<HTMLElement>('.coop-card')[1]!.click();
  expect(picks).toEqual([]);
  await new Promise((r) => setTimeout(r, 350));
  document.querySelectorAll<HTMLElement>('.coop-card')[1]!.click();
  expect(picks).toEqual([[1, 3]]);
  await new Promise((r) => setTimeout(r, 30));
  const strip = document.querySelector<HTMLElement>('.coop-cards')!;
  expect(strip.classList.contains('taking')).toBe(true);
  const chosen = document.querySelector<HTMLElement>('.coop-card.chosen')!;
  expect(getComputedStyle(chosen).animationName).toBe('coop-card-take');
  // It flies left and down, towards the kit.
  expect(Number.parseFloat(strip.style.getPropertyValue('--fly-x'))).toBeLessThan(0);
  await new Promise((r) => setTimeout(r, 100));
  if (import.meta.env['VITE_COOP_SHOTS']) await page.screenshot({ path: '__shots__/coop-card-take.png' });
  // A second press takes nothing more, and the strip is gone once the card has flown.
  chosen.click();
  expect(picks).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 600));
  expect(document.querySelector('.coop-cards')).toBeNull();
});
