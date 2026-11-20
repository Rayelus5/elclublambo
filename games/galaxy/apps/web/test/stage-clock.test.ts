import { expect, test } from 'vitest';
import { audioTime, createClock } from '../src/scanner/pro/clock';

// The pro scanner's clock (plan «escáner pro», part B): the timeline's time, read from one real clock (the audio
// clock when there is one), so pictures and sounds never drift apart. It pauses (a hidden tab), holds at a moment
// (the single card's wait, a card whose image is not ready), seeks (Seguir, Saltar) and runs slower (the Ensayo).

function fake() {
  let t = 100;
  return { now: () => t, advance: (s: number) => (t += s) };
}

test('avanza con el reloj real desde donde empieza', () => {
  const src = fake();
  const clock = createClock(src.now);
  expect(clock.now()).toBe(0);
  src.advance(1.5);
  expect(clock.now()).toBeCloseTo(1.5, 9);
});

test('en pausa no avanza, y al seguir continúa donde se quedó', () => {
  const src = fake();
  const clock = createClock(src.now);
  src.advance(1);
  clock.pause();
  src.advance(5);
  expect(clock.now()).toBeCloseTo(1, 9);
  expect(clock.paused).toBe(true);
  clock.resume();
  src.advance(0.5);
  expect(clock.now()).toBeCloseTo(1.5, 9);
});

test('se detiene en una espera y, al soltarla, sigue desde ella sin saltos', () => {
  const src = fake();
  const clock = createClock(src.now);
  clock.holdAt(2);
  src.advance(3);
  expect(clock.now()).toBe(2);
  expect(clock.held).toBe(2);
  src.advance(10);
  clock.holdAt(null);
  expect(clock.now()).toBe(2);
  src.advance(0.25);
  expect(clock.now()).toBeCloseTo(2.25, 9);
});

test('saltar lleva a otro momento y quita la espera que quede atrás', () => {
  const src = fake();
  const clock = createClock(src.now);
  clock.holdAt(2);
  clock.seek(5);
  expect(clock.held).toBe(null);
  src.advance(1);
  expect(clock.now()).toBeCloseTo(6, 9);
  clock.seek(1);
  expect(clock.now()).toBe(1);
});

test('a menos velocidad (Ensayo) el tiempo pasa más despacio, y dice cuánto falta de verdad', () => {
  const src = fake();
  const clock = createClock(src.now);
  clock.setRate(0.25);
  src.advance(2);
  expect(clock.now()).toBeCloseTo(0.5, 9);
  expect(clock.until(1.5)).toBeCloseTo(4, 9);
  clock.holdAt(1);
  expect(clock.until(1.5)).toBe(Infinity);
  expect(clock.until(0.75)).toBeCloseTo(1, 9);
});

test('el reloj de audio usa la marca de salida del contexto y, sin contexto, el del navegador', () => {
  const ctx = { state: 'running', currentTime: 10, getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 5000 }) } as unknown as AudioContext;
  const perf = () => 5100;
  expect(audioTime(ctx, perf)).toBeCloseTo(10, 9);
  expect(audioTime(null, perf)).toBeCloseTo(5.1, 9);
  const suspended = { ...ctx, state: 'suspended' } as unknown as AudioContext;
  expect(audioTime(suspended, perf)).toBeCloseTo(5.1, 9);
});
