import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setSettings } from '../src/audio/mixer';
import { playClaim } from '../src/missions/sfx';

// Collecting a reward sounds like what it gives (open beta): coins clink in a cascade, dust shimmers, a signal rings
// like a bell, and an achievement or a season mission gets a short fanfare. Muted, nothing plays.
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
    return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: (n: unknown) => n };
  }
  createBuffer(_c: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return { buffer: null, connect: (n: unknown) => n, start: () => started++, stop() {} };
  }
}
beforeEach(() => {
  started = 0;
  localStorage.clear();
  vi.stubGlobal('AudioContext', FakeContext);
});
afterEach(() => vi.unstubAllGlobals());

const count = (f: () => void) => {
  started = 0;
  f();
  return started;
};

test('suena según lo que da: más monedas, más tintineo; una señal añade campana; un logro, fanfarria', () => {
  const few = count(() => playClaim({ coins: 100 }));
  const many = count(() => playClaim({ coins: 2500 }));
  expect(few).toBeGreaterThan(0);
  expect(many).toBeGreaterThan(few);
  expect(count(() => playClaim({ coins: 100, signal: 1 }))).toBeGreaterThan(few);
  expect(count(() => playClaim({ coins: 100 }, true))).toBeGreaterThan(few);
});

test('con todo silenciado no suena nada', () => {
  setSettings({ muted: true });
  expect(count(() => playClaim({ coins: 2500, signal: 2 }, true))).toBe(0);
  setSettings({ muted: false });
});
