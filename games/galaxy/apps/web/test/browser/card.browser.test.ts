import { renderFromSeed } from '@galaxy/engine';
import type { Finish, GalaxySummary, Tier } from '@galaxy/shared';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { CardBack } from '../../src/cards/CardBack';
import { GalaxyCard } from '../../src/cards/GalaxyCard';
import '../../src/styles/app.css';

// Cards in a real Chromium (SwiftShader WebGL): the engine image is composed in the shared WebGL canvas and copied into
// each card, the frame takes its tier's colour, and the back carries the seed's own braille. CARD_SHOTS=1 also saves a
// screenshot of the five finishes for the visual review.
const FINISHES: [Finish, Tier][] = [
  ['normal', 'common'],
  ['holo', 'uncommon'],
  ['prismatic', 'rare'],
  ['braille', 'epic'],
  ['corrupt', 'legendary'],
];
const galaxy = (i: number, finish: Finish, tier: Tier): GalaxySummary => ({
  id: `g${i}`,
  seed: String(9_000_001 + i * 7919),
  tier,
  finish,
  traits: renderFromSeed(BigInt(9_000_001 + i * 7919), { columns: 48 }).traits as unknown as Record<string, string>,
  name: ['Kathra', 'Selem', 'Uxorrei', 'Thaselos', 'Zenreila'][i]!,
  designation: `GX-00${i}A7F`,
  featured: i === 4,
  level: i + 1,
  createdAt: '2026-11-06T20:00:00Z',
});

const until = async (check: () => boolean, ms = 60_000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('las cartas componen su galaxia, llevan el color de su rareza y el reverso su braille', { timeout: 90_000 }, async () => {
  await page.viewport(1560, 760);
  document.body.style.cssText = 'margin:0;background:#070a1c;';
  const host = document.createElement('div');
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:28px;padding:28px;width:1500px;';
  document.body.append(host);
  const cards = FINISHES.map(([finish, tier], i) => galaxy(i, finish, tier));
  flushSync(() =>
    createRoot(host).render([
      ...cards.map((g) => createElement(GalaxyCard, { key: g.id, galaxy: g, size: 220, interactive: true })),
      createElement(CardBack, { key: 'back', galaxy: cards[4]!, size: 220 }),
    ]),
  );

  await until(() => host.querySelectorAll('article[data-image="ready"]').length === 5);
  for (const art of host.querySelectorAll<HTMLElement>('.gcard-art')) {
    const canvas = art.querySelector('canvas')!;
    expect(canvas.width).toBe(Math.round(220 * devicePixelRatio));
    // Something of the galaxy is drawn: the brightest pixel is far above the deep background.
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let brightest = 0;
    for (let p = 0; p < data.length; p += 4) brightest = Math.max(brightest, data[p]! + data[p + 1]! + data[p + 2]!);
    expect(brightest).toBeGreaterThan(300);
  }

  const first = host.querySelector<HTMLElement>('.gcard')!;
  const box = first.getBoundingClientRect();
  expect(box.height / box.width).toBeCloseTo(1.4, 2);
  const legendary = host.querySelectorAll<HTMLElement>('.gcard')[4]!;
  expect(getComputedStyle(legendary).getPropertyValue('--tc').trim()).toBe('#ffc94a');

  const expected = renderFromSeed(BigInt(cards[4]!.seed), { columns: 48 }).text;
  await until(() => host.querySelector('.relief')?.textContent === expected);

  if (import.meta.env['VITE_CARD_SHOTS']) {
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: '__shots__/cards.png', element: host });
    // The same cards under the pointer: tilt, glare and the finishes at full strength.
    for (const tilt of host.querySelectorAll<HTMLElement>('.gcard:not(.gcard-back) .gcard-tilt')) {
      const r = tilt.getBoundingClientRect();
      tilt.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.72, clientY: r.top + r.height * 0.3 }));
    }
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: '__shots__/cards-active.png', element: host });
  }
});

test('en la fila del detalle la carta y su reverso guardan su 5:7 aunque la fila sea más alta', { timeout: 60_000 }, async () => {
  await page.viewport(1280, 1000);
  const host = document.createElement('div');
  host.className = 'detail-cards';
  host.style.height = '900px';
  document.body.append(host);
  const g = galaxy(0, 'normal', 'common');
  flushSync(() => createRoot(host).render([createElement(GalaxyCard, { key: 'f', galaxy: g, size: 250, interactive: true }), createElement(CardBack, { key: 'b', galaxy: g, size: 250 })]));
  const cards = host.querySelectorAll<HTMLElement>('.gcard');
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    expect(box.width).toBeCloseTo(250, 0);
    expect(box.height).toBeCloseTo(350, 0);
  }
  host.remove();
});

test('el reverso de una mítica deja ver su braille, sus rasgos y su nombre sobre el vacío', { timeout: 60_000 }, async () => {
  // The mythic's void (a layer under the frame) once covered the whole back in the Collection's detail (the 3D
  // Inspector paints its own back, so only the DOM back showed it): the content sits above it, its name in light ink.
  await page.viewport(1280, 900);
  document.body.style.cssText = 'margin:0;background:#070a1c;';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:10;display:flex;gap:28px;padding:28px;background:#070a1c;';
  document.body.append(host);
  const g = { ...galaxy(3, 'normal', 'mythic'), name: 'Orsel', designation: 'GX-F7F7A8' };
  const braille = { ...g, id: 'gb', finish: 'braille' as Finish };
  flushSync(() => createRoot(host).render([createElement(CardBack, { key: 'n', galaxy: g, size: 280 }), createElement(CardBack, { key: 'b', galaxy: braille, size: 280 })]));
  const expected = renderFromSeed(BigInt(g.seed), { columns: 48 }).text;
  await until(() => [...host.querySelectorAll('.relief')].every((r) => r.textContent === expected));

  for (const back of host.querySelectorAll<HTMLElement>('.gcard-back')) {
    for (const part of ['.gcard-relief', '.gcard-traits', '.gcard-back-name']) {
      const el = back.querySelector<HTMLElement>(part)!;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      expect(hit && el.contains(hit), `${part} se ve`).toBe(true);
    }
    // The name reads on the near black void: light ink, not the dark tint the other tiers print on their bright face.
    const [red, green, blue] = getComputedStyle(back.querySelector('.gcard-back-name')!).color.match(/[\d.]+/g)!.map(Number);
    expect(0.2126 * red! + 0.7152 * green! + 0.0722 * blue!).toBeGreaterThan(150);
  }

  if (import.meta.env['VITE_CARD_SHOTS']) {
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: '__shots__/card-back-mythic.png', element: host });
  }
  host.remove();
});
