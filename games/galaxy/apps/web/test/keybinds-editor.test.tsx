import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ArenaSection } from '../src/settings/SettingsSections';
import { getKeybinds, resetKeybinds } from '../src/settings/keybinds';

// Ajustes › Incursión › Controles (the owner, 2026-11-14): press a slot, then the key or the mouse button; Escape
// cancels; a key another action had leaves it and the line says so; «Restaurar por defecto» brings everything back.

const t = copy.settings;
const slot = (action: keyof typeof t.controlActions, n: 1 | 2) => screen.getByRole('button', { name: new RegExp(`^${t.controlActions[action]}, tecla ${n}:`) });
const listen = () => act(() => vi.runAllTimers());

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetKeybinds();
});
afterEach(() => {
  vi.useRealTimers();
  resetKeybinds();
});

test('pulsar un hueco espera la tecla, y la tecla queda', () => {
  render(<ArenaSection aim onAim={() => {}} />);
  fireEvent.click(slot('dash', 2));
  listen();
  expect(slot('dash', 2)).toHaveTextContent(t.controlsCapture);
  expect(screen.getByRole('status')).toHaveTextContent(t.controlsCaptureLive('Dash'));
  fireEvent.keyDown(window, { key: 'e', code: 'KeyE' });
  expect(getKeybinds().dash).toEqual(['ShiftLeft', 'KeyE']);
  expect(slot('dash', 2)).toHaveTextContent('E');
});

test('una tecla de otra acción se le quita, y lo dice', () => {
  render(<ArenaSection aim onAim={() => {}} />);
  fireEvent.click(slot('dash', 1));
  listen();
  fireEvent.keyDown(window, { key: 'q', code: 'KeyQ' });
  expect(getKeybinds().dash[0]).toBe('KeyQ');
  expect(getKeybinds().mark).toEqual([null, null]);
  expect(screen.getByRole('status')).toHaveTextContent(t.controlsMoved('Q', t.controlActions.mark));
});

test('Escape cancela sin cambiar nada, y un botón del ratón también vale', () => {
  render(<ArenaSection aim onAim={() => {}} />);
  fireEvent.click(slot('up', 1));
  listen();
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  expect(getKeybinds().up[0]).toBe('KeyW');
  fireEvent.click(slot('pause', 2));
  listen();
  fireEvent.pointerDown(window, { button: 2 });
  expect(getKeybinds().pause).toEqual(['KeyP', 'Mouse2']);
});

test('quitar una tecla y restaurar por defecto', () => {
  render(<ArenaSection aim onAim={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: t.controlsClear(t.controlActions.dash, 1) }));
  expect(getKeybinds().dash[0]).toBe(null);
  fireEvent.click(screen.getByRole('button', { name: t.controlsReset }));
  expect(getKeybinds().dash).toEqual(['ShiftLeft', 'Mouse0']);
  expect(screen.getByRole('status')).toHaveTextContent(t.controlsResetDone);
});
