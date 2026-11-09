import { afterEach, expect, test } from 'vitest';
import { applyCursor, CURSOR_COLORS, cursorSvg, readCursor, saveCursor } from '../src/ui/cursor';

// The game's own cursor (open beta): cartoon pixel art (a white glove pointing, the same glove tapping over what can
// be pressed, a sight for the arena) drawn as crisp SVG at 2×, 3× or 4×, tinted with the player's colour, applied with CSS variables only (the
// CSP has no inline styles) and remembered in this browser; off, the system's cursor comes back.
afterEach(() => {
  localStorage.clear();
  applyCursor({ on: false, size: 'medium', color: CURSOR_COLORS[0]!.hex });
});

test('cada forma es pixel art nítido del tamaño pedido y del color elegido', () => {
  const url = cursorSvg('arrow', '#45e3a6', 4);
  expect(url.startsWith('data:image/svg+xml')).toBe(true);
  const svg = decodeURIComponent(url.split(',')[1]!);
  expect(svg).toContain('width="64"');
  expect(svg).toContain('shape-rendering="crispEdges"');
  expect(svg).toContain('#45e3a6');
  expect(cursorSvg('hand', '#45e3a6', 2)).not.toBe(cursorSvg('arrow', '#45e3a6', 2));
  expect(decodeURIComponent(cursorSvg('aim', '#ff6b7a', 2).split(',')[1]!)).toContain('width="32"');
});

test('aplicarlo fija las variables del cursor con su punto activo; apagarlo vuelve al del sistema', () => {
  applyCursor({ on: true, size: 'large', color: '#45e3a6' });
  const root = document.documentElement;
  expect(root.classList.contains('custom-cursor')).toBe(true);
  expect(root.style.getPropertyValue('--cursor-default')).toMatch(/^url\("data:image\/svg\+xml.*"\) 20 0, auto$/);
  expect(root.style.getPropertyValue('--cursor-pointer')).toContain('data:image/svg+xml');
  expect(root.style.getPropertyValue('--cursor-aim')).toMatch(/ 32 32, crosshair$/);
  applyCursor({ on: false, size: 'large', color: '#45e3a6' });
  expect(root.classList.contains('custom-cursor')).toBe(false);
  expect(root.style.getPropertyValue('--cursor-default')).toBe('');
});

test('se recuerda en este navegador, y lo que no vale vuelve a lo de siempre', () => {
  expect(readCursor()).toEqual({ on: true, size: 'medium', color: CURSOR_COLORS[0]!.hex });
  saveCursor({ size: 'small', color: CURSOR_COLORS[2]!.hex });
  expect(readCursor()).toEqual({ on: true, size: 'small', color: CURSOR_COLORS[2]!.hex });
  localStorage.setItem('galaxy.cursor', JSON.stringify({ on: 'sí', size: 'enorme', color: 'javascript:alert(1)' }));
  expect(readCursor()).toEqual({ on: true, size: 'medium', color: CURSOR_COLORS[0]!.hex });
});
