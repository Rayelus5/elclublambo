import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  bindingOf,
  DEFAULT_KEYBINDS,
  getKeybinds,
  isAction,
  keyLabel,
  readStoredKeybinds,
  resetKeybinds,
  sanitizeKeybinds,
  setBinding,
} from '../src/settings/keybinds';

// Rebindable controls (the owner, 2026-11-14): every run action has two slots, a key or a mouse button; a key taken by
// another action leaves it; «Restaurar» brings the defaults back; what is kept is checked on the way in.

beforeEach(() => {
  localStorage.clear();
  resetKeybinds();
});
afterEach(() => resetKeybinds());

describe('los controles por defecto', () => {
  test('WASD y flechas, dash con SHIFT y clic izquierdo, mejoras con 1-3 y el teclado numérico, Enter, P y Q', () => {
    expect(DEFAULT_KEYBINDS.up).toEqual(['KeyW', 'ArrowUp']);
    expect(DEFAULT_KEYBINDS.dash).toEqual(['ShiftLeft', 'Mouse0']);
    expect(DEFAULT_KEYBINDS.pick1).toEqual(['Digit1', 'Numpad1']);
    expect(DEFAULT_KEYBINDS.confirm).toEqual(['Enter', 'NumpadEnter']);
    expect(DEFAULT_KEYBINDS.pause).toEqual(['KeyP', null]);
    expect(DEFAULT_KEYBINDS.mark).toEqual(['KeyQ', null]);
    // Space is no longer the dash (it picked a card by mistake).
    expect(Object.values(DEFAULT_KEYBINDS).flat()).not.toContain('Space');
  });

  test('las dos SHIFT (y CTRL, ALT) cuentan como la misma tecla', () => {
    expect(isAction('dash', 'ShiftLeft')).toBe(true);
    expect(isAction('dash', 'ShiftRight')).toBe(true);
    expect(isAction('dash', 'Mouse0')).toBe(true);
    expect(isAction('dash', 'Space')).toBe(false);
  });
});

describe('asignar', () => {
  test('una tecla nueva va a su hueco y se guarda', () => {
    setBinding('dash', 1, 'Space');
    expect(getKeybinds().dash).toEqual(['ShiftLeft', 'Space']);
    expect(readStoredKeybinds().dash).toEqual(['ShiftLeft', 'Space']);
  });

  test('una tecla que ya usaba otra acción se le quita, y dice cuál', () => {
    const moved = setBinding('dash', 0, 'KeyQ');
    expect(moved).toBe('mark');
    expect(getKeybinds().mark).toEqual([null, null]);
    expect(isAction('mark', 'KeyQ')).toBe(false);
    expect(isAction('dash', 'KeyQ')).toBe(true);
  });

  test('vaciar un hueco y restaurar los de siempre', () => {
    setBinding('up', 0, null);
    expect(getKeybinds().up).toEqual([null, 'ArrowUp']);
    resetKeybinds();
    expect(getKeybinds()).toEqual(DEFAULT_KEYBINDS);
  });

  test('Escape nunca se asigna: siempre pausa', () => {
    expect(setBinding('dash', 0, 'Escape')).toBe(null);
    expect(getKeybinds().dash[0]).toBe('ShiftLeft');
  });
});

describe('lo guardado se comprueba', () => {
  test('acciones desconocidas, códigos raros, Escape y repetidos se descartan; lo que falta vuelve al de siempre', () => {
    const clean = sanitizeKeybinds({ dash: ['KeyE', 'KeyE'], up: ['<script>', 'Escape'], nope: ['KeyZ', null], pick1: 'Digit1' });
    expect(clean.dash).toEqual(['KeyE', null]);
    expect(clean.up).toEqual([null, null]);
    expect(clean.pick1).toEqual(DEFAULT_KEYBINDS.pick1);
    expect('nope' in clean).toBe(false);
    expect(clean.down).toEqual(DEFAULT_KEYBINDS.down);
  });

  test('una tecla en dos acciones se queda en la primera', () => {
    const clean = sanitizeKeybinds({ dash: ['KeyW', null] });
    expect(clean.up[0]).toBe('KeyW');
    expect(clean.dash).toEqual([null, null]);
  });
});

test('los nombres de las teclas', () => {
  expect(keyLabel('ShiftLeft')).toBe('SHIFT');
  expect(keyLabel('Mouse0')).toBe('Clic izquierdo');
  expect(keyLabel('Mouse2')).toBe('Clic derecho');
  expect(keyLabel('KeyW')).toBe('W');
  expect(keyLabel('Digit1')).toBe('1');
  expect(keyLabel('Numpad1')).toBe('Num 1');
  expect(keyLabel('Space')).toBe('Espacio');
  expect(keyLabel('ArrowUp')).toBe('Flecha arriba');
  expect(keyLabel(null)).toBe('');
  expect(bindingOf('dash')).toBe('SHIFT');
  setBinding('dash', 0, null);
  expect(bindingOf('dash')).toBe('Clic izquierdo');
});
