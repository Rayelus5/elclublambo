import { afterEach, expect, test } from 'vitest';
import { applyCursor, CURSOR_COLORS, CURSOR_SHAPES, cursorSvg, cursorVar, readCursor, saveCursor } from '../src/ui/cursor';

// The game's own cursor (open beta): a chrome sparkle in pixel art (a four-point star whose long point is the tip,
// with a sparkle over what can be pressed, a sight for the arena) drawn as crisp SVG, tinted with the player's colour,
// applied with CSS variables only (the CSP has no inline styles) and remembered in this browser; off, the system's
// cursor comes back. Drawn at 1×, 2× or 3× (24, 48 or 72 px).
afterEach(() => {
  localStorage.clear();
  applyCursor({ on: false, size: 'medium', color: CURSOR_COLORS[0]!.hex });
});

test('cada forma es pixel art nítido del tamaño pedido y del color elegido', () => {
  const url = cursorSvg('default', '#45e3a6', 3);
  expect(url.startsWith('data:image/svg+xml')).toBe(true);
  const svg = decodeURIComponent(url.split(',')[1]!);
  expect(svg).toContain('width="72"');
  expect(svg).toContain('viewBox="0 0 24 24"');
  expect(svg).toContain('shape-rendering="crispEdges"');
  expect(svg).toContain('#45e3a6');
  expect(cursorSvg('pointer', '#45e3a6', 2)).not.toBe(cursorSvg('default', '#45e3a6', 2));
  expect(decodeURIComponent(cursorSvg('aim', '#ff6b7a', 2).split(',')[1]!)).toContain('width="48"');
});

test('aplicarlo fija las variables del cursor con su punto activo; apagarlo vuelve al del sistema', () => {
  applyCursor({ on: true, size: 'large', color: '#45e3a6' });
  const root = document.documentElement;
  expect(root.classList.contains('custom-cursor')).toBe(true);
  expect(root.style.getPropertyValue('--cursor-default')).toMatch(/^url\("data:image\/svg\+xml.*"\) 6 0, auto$/);
  expect(root.style.getPropertyValue('--cursor-pointer')).toContain('data:image/svg+xml');
  expect(root.style.getPropertyValue('--cursor-aim')).toMatch(/ 36 36, crosshair$/);
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

test('cada estado del cursor tiene su dibujo y su variable: normal, pulsable, al pulsar, texto, no permitido, cargando, ayuda, agarrar, arrastrando y apuntar', () => {
  expect(CURSOR_SHAPES).toEqual(['default', 'pointer', 'press', 'text', 'notAllowed', 'wait', 'help', 'grab', 'grabbing', 'aim']);
  const drawn = new Set(CURSOR_SHAPES.map((s) => cursorSvg(s, '#ffc94a', 1)));
  expect(drawn.size).toBe(CURSOR_SHAPES.length);
  applyCursor({ on: true, size: 'medium', color: '#ffc94a' });
  const root = document.documentElement;
  expect(root.style.getPropertyValue(cursorVar('notAllowed'))).toMatch(/, not-allowed$/);
  expect(root.style.getPropertyValue(cursorVar('text'))).toMatch(/ 24 24, text$/);
  expect(root.style.getPropertyValue(cursorVar('grabbing'))).toMatch(/, grabbing$/);
  expect(cursorVar('notAllowed')).toBe('--cursor-not-allowed');
});

test('la estrella es de cromo: borde de hielo, franja blanca, horizonte violeta, el color del jugador y una sombra suave', () => {
  const svg = decodeURIComponent(cursorSvg('default', '#45e3a6', 1).split(',')[1]!);
  expect(svg).toContain('#c6ecff');
  expect(svg).toContain('#ffffff');
  expect(svg).toContain('#a991ff');
  expect(svg).toContain('#45e3a6');
  expect(svg).toMatch(/fill="#05061a" fill-opacity="0\.6"/);
  // Al pulsar, la estrella se encoge hacia su punta, que sigue siendo el punto activo.
  applyCursor({ on: true, size: 'small', color: '#45e3a6' });
  expect(document.documentElement.style.getPropertyValue(cursorVar('press'))).toMatch(/ 3 0, pointer$/);
});
