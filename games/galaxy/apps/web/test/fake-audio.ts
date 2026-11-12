import { vi } from 'vitest';

// A WebAudio context for tests (no sound): it builds the node graph, records every start (when) and every gain move,
// decodes "files" into buffers, and keeps an output timestamp. Enough for recipes, the bank, the score and the clock.

export interface Started {
  kind: 'osc' | 'buffer';
  at: number;
  buffer?: FakeBuffer;
}

export class FakeBuffer {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.channels[c]!;
  }
}

export interface ParamMove {
  kind: string;
  value: number;
  at: number;
}

function param(value = 0) {
  const moves: ParamMove[] = [];
  return {
    value,
    moves,
    setValueAtTime(v: number, at: number) {
      moves.push({ kind: 'set', value: v, at });
      return this;
    },
    linearRampToValueAtTime(v: number, at: number) {
      moves.push({ kind: 'linear', value: v, at });
      return this;
    },
    exponentialRampToValueAtTime(v: number, at: number) {
      if (v <= 0) throw new RangeError('exponential ramp to a non-positive value');
      moves.push({ kind: 'exp', value: v, at });
      return this;
    },
    setTargetAtTime(v: number, at: number) {
      moves.push({ kind: 'target', value: v, at });
      return this;
    },
    cancelScheduledValues(at: number) {
      moves.push({ kind: 'cancel', value: 0, at });
      return this;
    },
  };
}

export interface FakeGain {
  gain: ReturnType<typeof param>;
  connect: (n: unknown) => unknown;
  disconnect(): void;
}

export class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8_000;
  destination = { kind: 'destination' };
  started: Started[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {});
  createOscillator() {
    const started = this.started;
    return {
      type: '',
      frequency: param(440),
      detune: param(0),
      connect: (n: unknown) => n,
      start(at = 0) {
        started.push({ kind: 'osc', at });
      },
      stop() {},
    };
  }
  createGain(): FakeGain {
    const g: FakeGain = { gain: param(1), connect: (n: unknown) => n, disconnect() {} };
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return { type: '', frequency: param(350), Q: param(1), connect: (n: unknown) => n };
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new FakeBuffer(channels, length, rate);
  }
  createBufferSource() {
    const started = this.started;
    const src = {
      buffer: null as FakeBuffer | null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      stops: [] as number[],
      connect: (n: unknown) => n,
      start(at = 0) {
        started.push({ kind: 'buffer', at, buffer: src.buffer ?? undefined });
      },
      stop(at = 0) {
        src.stops.push(at);
      },
    };
    return src;
  }
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => new FakeBuffer(1, Math.max(1, data.byteLength) * 100, 8_000));
  getOutputTimestamp() {
    return { contextTime: this.currentTime, performanceTime: 0 };
  }
}

/** The context, typed as the real one for the code under test. */
export function fakeContext(): FakeAudioContext & AudioContext {
  return new FakeAudioContext() as FakeAudioContext & AudioContext;
}
