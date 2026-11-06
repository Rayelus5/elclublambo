import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createSfx } from '../src/scanner/sfx';

// The scanner's sounds (GDD §9): the clack of a Perkins braille machine and a chord whose colour follows the rarity,
// synthesised with WebAudio (no files, nothing for the CSP to allow). Muting is remembered.
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

test('el clac y el acorde suenan, y el acorde de una Legendaria tiene más notas', () => {
  const sfx = createSfx();
  sfx.clack();
  expect(started).toBeGreaterThan(0);
  started = 0;
  sfx.chord('common');
  const common = started;
  started = 0;
  sfx.chord('legendary');
  expect(started).toBeGreaterThan(common);
});

test('silenciado no suena nada y el silencio se recuerda', () => {
  const sfx = createSfx();
  sfx.setMuted(true);
  sfx.clack();
  sfx.chord('epic');
  expect(started).toBe(0);
  expect(createSfx().muted()).toBe(true);
  createSfx().setMuted(false);
  expect(createSfx().muted()).toBe(false);
});

test('sin WebAudio no falla', () => {
  vi.stubGlobal('AudioContext', undefined);
  const sfx = createSfx();
  expect(() => {
    sfx.clack();
    sfx.chord('rare');
  }).not.toThrow();
});
