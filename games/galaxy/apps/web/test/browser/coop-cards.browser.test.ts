import { DEFAULT_CONTENT, type HudSnapshot, type Offer } from '@galaxy/sim';
import { gainRows, offerGains } from '../../src/arena/hud/gains';
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
      // What it does on a new card, every number it changes on a level-up (2026-11-27).
      const said = (c.querySelector('.coop-card-desc')?.textContent ?? '') + (c.querySelector('.gain-rows')?.textContent ?? '');
      expect(said.length).toBeGreaterThan(10);
    }
    if (import.meta.env['VITE_COOP_SHOTS']) await page.screenshot({ path: `__shots__/coop-cards-${width}.png` });
  });
}

// The longest cards there are (the owner, 2026-11-27: «pensar bien cómo mostrar toda la info en el caso de que hayan
// muchos cambios»): the evolution and the two level-ups with the most changes, every row whole, the strip still under a
// third of the screen.
const rowsOf = (o: Offer) => gainRows(offerGains(DEFAULT_CONTENT, o)).length;
const all: Offer[] = DEFAULT_CONTENT.weapons.flatMap((w): Offer[] => (w.evolution ? [{ kind: 'evolve', id: w.id, level: 1 }] : w.levels.map((_, i) => ({ kind: 'weapon', id: w.id, level: i + 1 }))));
const byRows = [...all].sort((a, b) => rowsOf(b) - rowsOf(a));
const longest = [byRows.find((o) => o.kind === 'evolve')!, ...byRows.filter((o) => o.kind === 'weapon' && o.level > 1).filter((o, i, xs) => xs.findIndex((x) => x.id === o.id) === i).slice(0, 2)];
for (const [width, height] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`las cartas de grupo con más cambios los enseñan todos y la tira cabe a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.className = 'coop-arena';
    host.style.cssText = 'position:relative;width:100vw;height:100vh;background:#070a1c';
    document.body.appendChild(host);
    root = createRoot(host);
    const long = { offer: longest, coop: { offerSeq: 4, pickLeft: 9 } } as unknown as HudSnapshot;
    root.render(createElement(CoopCards, { hud: long, content: DEFAULT_CONTENT, pickSeconds: 15, onPick: () => {} }));
    await new Promise((r) => setTimeout(r, 600));
    const strip = document.querySelector<HTMLElement>('.coop-cards')!;
    expect(strip.getBoundingClientRect().height).toBeLessThanOrEqual(height * 0.34);
    const cards = [...document.querySelectorAll<HTMLElement>('.coop-card')];
    cards.forEach((c, i) => {
      expect(c.querySelectorAll('.gain-rows li').length).toBe(rowsOf(longest[i]!));
      expect(c.scrollWidth).toBeLessThanOrEqual(c.clientWidth + 1);
      // Each row whole: its name and its values fit.
      for (const el of c.querySelectorAll<HTMLElement>('.gain-label, .gain-values, .gain-trait')) expect(el.scrollWidth, el.textContent ?? '').toBeLessThanOrEqual(el.clientWidth + 1);
    });
    if (import.meta.env['VITE_COOP_SHOTS']) await page.screenshot({ path: `__shots__/coop-cards-long-${width}.png` });
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
