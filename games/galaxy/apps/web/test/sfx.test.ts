import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createSfx } from '../src/scanner/sfx';

// The scanner's sounds (GDD §9): the clack of a Perkins braille machine and a chord whose colour follows the rarity,
// synthesised with WebAudio (no files, nothing for the CSP to allow). Muting is remembered.
let started: number;
/** Every oscillator's first frequency, in the order they are set. */
let freqs: number[] = [];
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  sampleRate = 48_000;
  resume = vi.fn(async () => {});
  createOscillator() {
    let set = false;
    const frequency = {
      value: 0,
      setValueAtTime(hz: number) {
        if (!set) freqs.push(hz);
        set = true;
      },
      exponentialRampToValueAtTime() {},
      linearRampToValueAtTime() {},
    };
    return { type: '', frequency, detune: { value: 0, setValueAtTime() {} }, connect: (n: unknown) => n, start: () => started++, stop() {} };
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

test('una Mítica suena al menos como una Legendaria: su acorde y su impacto', () => {
  const sfx = createSfx();
  started = 0;
  sfx.chord('legendary');
  const legendary = started;
  started = 0;
  sfx.chord('mythic');
  expect(started).toBeGreaterThanOrEqual(legendary);
  expect(nodes(() => sfx.impact('mythic'))).toBeGreaterThanOrEqual(nodes(() => sfx.impact('legendary')));
  expect(nodes(() => sfx.riser('mythic', 1.6))).toBeGreaterThan(0);
});

// Plan «rareza Mítica» M2: the Mítica's own chord — not the legendary's arpeggio: a low swell under a Lydian stack that
// blooms upward, each voice a slightly detuned pair (it shimmers). The legendary's stays exactly as it was.
const toneOf = (hz: number) => Math.round(12 * Math.log2(hz / 440) + 69);
function heard(f: () => void): number[] {
  freqs = [];
  f();
  return freqs;
}

test('una Mítica tiene su propio acorde: un grave que crece, una cuarta aumentada y voces desafinadas que brillan', () => {
  const sfx = createSfx();
  const legendary = heard(() => sfx.chord('legendary'));
  expect(legendary).toEqual([392, 493.88, 587.33, 739.99, 880, 1174.66]);
  const mythic = heard(() => sfx.chord('mythic'));
  expect(mythic.length).toBeGreaterThan(legendary.length * 2);
  // A low swell under it (nothing that low in the legendary's).
  expect(Math.min(...mythic)).toBeLessThan(150);
  expect(Math.min(...legendary)).toBeGreaterThan(150);
  // The raised fourth of G Lydian (C#), which the legendary's never plays.
  const tones = new Set(mythic.map((hz) => toneOf(hz) % 12));
  expect(tones.has(1)).toBe(true);
  expect(legendary.some((hz) => toneOf(hz) % 12 === 1)).toBe(false);
  // Detuned pairs: two voices a few cents apart on the same note.
  const pairs = mythic.filter((a, i) => mythic.some((b, j) => j !== i && a !== b && Math.abs(1200 * Math.log2(a / b)) < 20));
  expect(pairs.length).toBeGreaterThanOrEqual(8);
  // It is not just the legendary's arpeggio with more on top.
  expect(mythic.slice(0, legendary.length)).not.toEqual(legendary);
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

// Open beta: a ping per signal bar, the rising scan, the impact of the reveal (heavier the rarer), the Legendary's
// fanfare and the featured sting; muted, nothing.
const nodes = (f: () => void) => {
  started = 0;
  f();
  return started;
};

test('un ping por barra, un impacto más fuerte cuanto más rara, la fanfarria y el aviso de destacada suenan', () => {
  const sfx = createSfx();
  expect(nodes(() => sfx.bars(5))).toBeGreaterThan(nodes(() => sfx.bars(1)));
  expect(nodes(() => sfx.riser('rare', 1.6))).toBeGreaterThan(0);
  expect(nodes(() => sfx.impact('legendary'))).toBeGreaterThan(nodes(() => sfx.impact('common')));
  expect(nodes(() => sfx.fanfare())).toBeGreaterThan(0);
  expect(nodes(() => sfx.sting())).toBeGreaterThan(0);
  expect(nodes(() => sfx.ping(3))).toBeGreaterThan(0);
  sfx.setMuted(true);
  expect(nodes(() => {
    sfx.bars(5);
    sfx.impact('legendary');
    sfx.fanfare();
  })).toBe(0);
  sfx.setMuted(false);
});
