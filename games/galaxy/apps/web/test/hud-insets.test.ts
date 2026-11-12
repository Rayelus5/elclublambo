import { expect, test } from 'vitest';
import { hudInsets } from '../src/coop/hud-insets';

// Where the HUD covers the arena (Nov plan A2 review): the teammates' arrows stay out of those bands.
const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom }) as DOMRect;

test('el panel de arriba, la lista del equipo, el kit y las cartas dan sus márgenes', () => {
  const canvas = r(0, 0, 1280, 720);
  expect(hudInsets(canvas, { top: r(20, 22, 1260, 90), team: r(20, 88, 210, 300), kit: r(20, 640, 400, 700), cards: null })).toEqual({ top: 98, right: 0, bottom: 88, left: 218 });
  // The cards' strip, while it is open, covers more of the bottom than the kit.
  expect(hudInsets(canvas, { top: null, team: null, kit: r(20, 640, 400, 700), cards: r(260, 480, 1020, 700) }).bottom).toBe(248);
});

test('sin HUD no hay márgenes', () => {
  expect(hudInsets(r(0, 0, 1280, 720), { top: null, team: null, kit: null, cards: null })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
});
