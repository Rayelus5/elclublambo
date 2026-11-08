import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setSettings } from '../src/audio/mixer';
import { UiSounds } from '../src/audio/UiSounds';
import { playUi, soundOf } from '../src/audio/ui-sfx';

// The interface's sounds (M8 polish): each kind of control its sound, silent when muted, at zero or switched off, and
// one global listener so every button sounds without asking.
let started: number;
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  sampleRate = 48_000;
  resume = vi.fn(async () => {});
  createOscillator() {
    return { type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n, start: () => started++, stop() {} };
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect: (n: unknown) => n };
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: (n: unknown) => n };
  }
}

beforeEach(() => {
  started = 0;
  vi.stubGlobal('AudioContext', FakeContext);
  setSettings({ music: 0.5, sfx: 0.8, muted: false, ui: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const el = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box.firstElementChild!;
};

test('cada control tiene su sonido: pestañas, interruptores, acciones principales, volver y el resto un toque', () => {
  expect(soundOf(el('<button role="tab" aria-selected="true">Diarias</button>'))).toBe('tab');
  expect(soundOf(el('<input type="checkbox">'))).toBe('toggle');
  expect(soundOf(el('<button role="switch">Mercado</button>'))).toBe('toggle');
  expect(soundOf(el('<button class="lip pill pill-solar">Recoger</button>'))).toBe('confirm');
  expect(soundOf(el('<a class="lip play" href="/incursion">Jugar</a>'))).toBe('confirm');
  expect(soundOf(el('<a class="lip pill" data-sfx="back" href="/">Volver</a>'))).toBe('back');
  expect(soundOf(el('<button class="lip pill">Ocultar</button>'))).toBe('tap');
});

test('suena con los efectos; no suena silenciado, con los efectos a cero ni con la casilla apagada', () => {
  playUi('confirm');
  expect(started).toBeGreaterThan(0);
  for (const off of [{ muted: true }, { sfx: 0 }, { ui: false }]) {
    setSettings({ muted: false, sfx: 0.8, ui: true, ...off });
    started = 0;
    playUi('tab');
    expect(started).toBe(0);
  }
});

test('el oyente global suena al pulsar un botón, no en uno desactivado, y al pasar por un botón grande del menú', () => {
  render(
    <>
      <UiSounds />
      <button type="button">Activo</button>
      <button type="button" disabled>
        Desactivado
      </button>
      <a href="/coleccion" data-sfx="hover">
        Colección
      </a>
    </>,
  );
  const [active, disabled] = document.querySelectorAll('button');
  fireEvent.pointerDown(disabled!, { button: 0 });
  expect(started).toBe(0);
  fireEvent.pointerDown(active!, { button: 0 });
  expect(started).toBeGreaterThan(0);
  started = 0;
  fireEvent.pointerOver(document.querySelector('a')!);
  expect(started).toBeGreaterThan(0);
});
