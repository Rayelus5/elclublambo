import { expect, test } from 'vitest';
import { DASH_BUFFER, dashWaits, emptyInput, pointerAngle, readInput } from '../src/arena/input';
import { cardKey } from '../src/ui/keys';

// Controls (GDD §5.2): WASD or arrows, a gamepad with a dead zone, and optional manual aim with the mouse or the
// right stick. Analog values are quantised so the recorded log stays small.

const keys = (...k: string[]) => ({ ...emptyInput(), keys: new Set(k) });

test('teclado: WASD y flechas dan ±127, opuestos se anulan', () => {
  expect(readInput(keys('KeyW'), { manualAim: false })).toEqual({ mx: 0, my: -127, aim: -1, pick: -1 });
  expect(readInput(keys('ArrowRight', 'ArrowDown'), { manualAim: false })).toMatchObject({ mx: 127, my: 127 });
  expect(readInput(keys('KeyA', 'KeyD'), { manualAim: false })).toMatchObject({ mx: 0, my: 0 });
});

test('mando: zona muerta de 0,2 y 16 direcciones a media o plena marcha', () => {
  const pad = (x: number, y: number) => ({ ...emptyInput(), pad: { x, y, rx: 0, ry: 0 } });
  expect(readInput(pad(0.15, -0.1), { manualAim: false })).toMatchObject({ mx: 0, my: 0 });
  expect(readInput(pad(1, 0), { manualAim: false })).toMatchObject({ mx: 127, my: 0 });
  expect(readInput(pad(0.4, 0), { manualAim: false })).toMatchObject({ mx: 64, my: 0 });
  const diag = readInput(pad(0.71, 0.69), { manualAim: false });
  expect(diag.mx).toBe(diag.my);
  expect(diag.mx).toBe(Math.round(Math.cos(Math.PI / 4) * 127));
});

test('apuntado manual: el ángulo sigue al ratón en 64 direcciones; sin él, automático', () => {
  const s = { ...emptyInput(), mouse: { x: 200, y: 100 } };
  expect(readInput(s, { manualAim: false }, { x: 100, y: 100 }).aim).toBe(-1);
  expect(readInput(s, { manualAim: true }, { x: 100, y: 100 }).aim).toBe(0);
  const down = readInput({ ...emptyInput(), mouse: { x: 100, y: 300 } }, { manualAim: true }, { x: 100, y: 100 });
  expect(down.aim).toBe(1024);
  expect(readInput({ ...emptyInput(), mouse: { x: 150, y: 160 } }, { manualAim: true }, { x: 100, y: 100 }).aim % 64).toBe(0);
});

test('el stick derecho apunta si el apuntado manual está activo', () => {
  const s = { ...emptyInput(), pad: { x: 0, y: 0, rx: 0, ry: -1 } };
  expect(readInput(s, { manualAim: true }).aim).toBe(3072);
  expect(readInput(s, { manualAim: false }).aim).toBe(-1);
});

// The dash (SIM 1.12.0): standing still it goes where the player points; a press during the short pause between two
// waits for it; the card keys read the key's place (SHIFT held turns «1» into «!»).
test('el dash apunta al stick derecho, si no al ratón, y si no a ningún sitio', () => {
  const s = emptyInput();
  expect(pointerAngle(s, { x: 0, y: 0 })).toBe(-1);
  s.mouse = { x: 0, y: 100 };
  expect(pointerAngle(s, { x: 0, y: 0 })).toBe(1024);
  s.pad = { x: 0, y: 0, rx: -1, ry: 0 };
  expect(pointerAngle(s, { x: 0, y: 0 })).toBe(2048);
});

test('una pulsación en la pausa entre dos dashes espera; sin carga o fuera de la pausa, sale ya', () => {
  expect(dashWaits({ charges: 1, pause: 10 })).toBe(true);
  expect(dashWaits({ charges: 1, pause: DASH_BUFFER + 1 })).toBe(true);
  expect(dashWaits({ charges: 1, pause: 1 })).toBe(false);
  expect(dashWaits({ charges: 1, pause: 0 })).toBe(false);
  expect(dashWaits({ charges: 0, pause: 10 })).toBe(false);
  expect(dashWaits({ charges: 1, pause: DASH_BUFFER + 5 })).toBe(false);
  expect(dashWaits(undefined)).toBe(false);
});

test('las teclas de las cartas se leen por su sitio, también con SHIFT pulsado y en el teclado numérico', () => {
  expect(cardKey('Digit1')).toBe(1);
  expect(cardKey('Numpad3')).toBe(3);
  expect(cardKey('KeyA')).toBe(0);
  expect(cardKey('Digit0')).toBe(0);
});
