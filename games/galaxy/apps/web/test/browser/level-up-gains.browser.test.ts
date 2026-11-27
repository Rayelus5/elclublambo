import { DEFAULT_CONTENT, type Offer } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { gainRows, offerGains } from '../../src/arena/hud/gains';
import { LevelUp } from '../../src/arena/hud/LevelUp';
import '../../src/styles/app.css';
import bungeeUrl from '../../public/fonts/bungee-latin.woff2?url';
import fredokaUrl from '../../public/fonts/fredoka-latin.woff2?url';

// «Elige una mejora» in solo runs with what each level gives (design C, the owner's pick, 2026-11-27): the cards with
// the most changes there are show every row whole, and the window fits the screen without scrolling.
// VITE_ARENA_SHOTS=1 saves screenshots.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

async function gameFonts(): Promise<void> {
  const faces = [new FontFace('Bungee', `url(${bungeeUrl})`), new FontFace('Fredoka', `url(${fredokaUrl})`, { weight: '300 700' })];
  for (const f of faces) document.fonts.add(await f.load());
}

const rowsOf = (o: Offer) => gainRows(offerGains(DEFAULT_CONTENT, o)).length;
const all: Offer[] = DEFAULT_CONTENT.weapons.flatMap((w): Offer[] => (w.evolution ? [{ kind: 'evolve', id: w.id, level: 1 }] : w.levels.map((_, i) => ({ kind: 'weapon', id: w.id, level: i + 1 }))));
const byRows = [...all].sort((a, b) => rowsOf(b) - rowsOf(a));
const longest = byRows.filter((o) => o.kind === 'evolve').slice(0, 3);
const mixed: Offer[] = [{ kind: 'weapon', id: 'pulse', level: 3 }, { kind: 'passive', id: 'amplifier', level: 3 }, byRows.find((o) => o.kind === 'weapon' && o.level > 1)!];

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
] as const) {
  for (const [name, offer] of [
    ['largas', longest],
    ['mezcla', mixed],
  ] as const) {
    test(`la ventana de mejoras con cartas ${name} cabe y enseña cada fila entera a ${width}×${height}`, async () => {
      await page.viewport(width, height);
      await gameFonts();
      document.body.style.margin = '0';
      const host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(createElement(LevelUp, { offer, content: DEFAULT_CONTENT, onPick: () => {} }));
      await new Promise((r) => setTimeout(r, 500));
      const modal = document.querySelector<HTMLElement>('.modal.levelup')!;
      const box = modal.getBoundingClientRect();
      expect(box.bottom).toBeLessThanOrEqual(height);
      expect(modal.scrollHeight).toBeLessThanOrEqual(modal.clientHeight + 1);
      const cards = [...document.querySelectorAll<HTMLElement>('.levelup-card')];
      cards.forEach((c, i) => {
        expect(c.querySelectorAll('.gain-rows li').length).toBe(rowsOf(offer[i]!));
        expect(c.scrollWidth).toBeLessThanOrEqual(c.clientWidth + 1);
        for (const el of c.querySelectorAll<HTMLElement>('.gain-label, .gain-values')) expect(el.scrollWidth, el.textContent ?? '').toBeLessThanOrEqual(el.clientWidth + 1);
      });
      if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/levelup-gains-${name}-${width}.png` });
    }, 30_000);
  }
}
