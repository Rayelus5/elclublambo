import { describe, expect, test } from 'vitest';
import {
  FADE_MS,
  galaxyReady,
  initialState,
  layerStyles,
  nextPhase,
  SCAN_MS,
  SHOW_MS,
  type BackdropState,
} from '../src/scene/backdrop-schedule';

// The access backdrop (DESIGN_SYSTEM §8): one galaxy at a time, scanned in, shown, cross-faded into the next.
// `now` is the backdrop's own clock, which only runs while the tab is visible.
const run = (s: BackdropState, from: number, to: number, step = 100) => {
  for (let t = from; t <= to; t += step) s = nextPhase(s, t);
  return s;
};

describe('secuencia', () => {
  test('espera la primera galaxia, la escanea, la muestra y la funde con la siguiente', () => {
    let s = initialState(false);
    expect(s.phase).toBe('waiting');
    expect(s.incoming).toBe(1);
    s = nextPhase(s, 500);
    expect(s.phase).toBe('waiting');
    s = galaxyReady(s, 1);
    s = nextPhase(s, 600);
    expect(s).toMatchObject({ phase: 'scanning', since: 600, shown: 1, incoming: 0 });
    s = nextPhase(s, 600 + SCAN_MS);
    expect(s).toMatchObject({ phase: 'showing', since: 600 + SCAN_MS, shown: 1, incoming: 2 });
    // The next galaxy is requested right away, but the current one stays its full time.
    s = galaxyReady(s, 2);
    s = nextPhase(s, 600 + SCAN_MS + SHOW_MS - 1);
    expect(s.phase).toBe('showing');
    s = nextPhase(s, 600 + SCAN_MS + SHOW_MS);
    expect(s).toMatchObject({ phase: 'fading', shown: 1, incoming: 2 });
    const fadeStart = s.since;
    s = nextPhase(s, fadeStart + FADE_MS);
    expect(s).toMatchObject({ phase: 'showing', since: fadeStart + FADE_MS, shown: 2, incoming: 3 });
  });

  test('si la siguiente no está lista, la actual sigue en pantalla hasta que lo esté', () => {
    let s = galaxyReady(initialState(false), 1);
    s = run(s, 0, SCAN_MS + SHOW_MS + 4000);
    expect(s).toMatchObject({ phase: 'showing', shown: 1, incoming: 2 });
    s = galaxyReady(s, 2);
    s = nextPhase(s, SCAN_MS + SHOW_MS + 4100);
    expect(s.phase).toBe('fading');
  });

  test('nunca hay más de dos galaxias vivas', () => {
    let s = initialState(false);
    for (let t = 0; t < 10 * (SHOW_MS + FADE_MS); t += 250) {
      if (s.incoming) s = galaxyReady(s, s.incoming);
      s = nextPhase(s, t);
      const alive = [s.shown, s.incoming].filter(Boolean);
      expect(alive.length).toBeLessThanOrEqual(2);
      expect(layerStyles(s, t).length).toBeLessThanOrEqual(2);
    }
    expect(s.shown).toBeGreaterThan(5);
  });

  test('un aviso de una galaxia que ya no se espera no cambia nada', () => {
    const s = initialState(false);
    expect(galaxyReady(s, 7)).toBe(s);
  });
});

describe('reloj y movimiento reducido', () => {
  test('con la pestaña oculta el reloj no avanza, así que la fase tampoco (Review Focus 5)', () => {
    let s = nextPhase(galaxyReady(initialState(false), 1), 1000);
    const frozen = nextPhase(s, 1000);
    expect(frozen).toEqual(s);
    s = nextPhase(s, 1000 + SCAN_MS / 2);
    expect(s.phase).toBe('scanning');
  });

  test('con movimiento reducido hay una sola galaxia quieta, siempre en showing', () => {
    let s = initialState(true);
    s = nextPhase(galaxyReady(s, 1), 0);
    expect(s).toMatchObject({ phase: 'showing', shown: 1, incoming: 0 });
    s = run(s, 0, 5 * (SHOW_MS + FADE_MS), 500);
    expect(s).toMatchObject({ phase: 'showing', shown: 1, incoming: 0 });
    const [layer, ...rest] = layerStyles(s, 5 * SHOW_MS);
    expect(rest).toHaveLength(0);
    expect(layer).toMatchObject({ id: 1, opacity: 1, reveal: 1, rotate: 0, scale: 1, glow: 1 });
  });
});

describe('capas', () => {
  test('el escaneo revela la galaxia de arriba abajo y el fundido cruza las opacidades', () => {
    let s = nextPhase(galaxyReady(initialState(false), 1), 0);
    expect(layerStyles(s, SCAN_MS / 2)[0]).toMatchObject({ id: 1, reveal: 0.5, opacity: 1 });
    s = galaxyReady(nextPhase(s, SCAN_MS), 2);
    s = nextPhase(s, SCAN_MS + SHOW_MS);
    const mid = layerStyles(s, SCAN_MS + SHOW_MS + FADE_MS / 2);
    const out = mid.find((l) => l.id === 1)!;
    const inc = mid.find((l) => l.id === 2)!;
    expect(out.opacity).toBeGreaterThan(0);
    expect(out.opacity).toBeLessThan(1);
    expect(inc.opacity).toBeGreaterThan(0);
    expect(inc.reveal).toBeLessThan(1);
    // The scan (SCAN_MS) is shorter than the fade: the incoming galaxy is fully resolved before the old one is gone.
    const late = layerStyles(s, SCAN_MS + SHOW_MS + FADE_MS * 0.8);
    expect(late.find((l) => l.id === 2)!.reveal).toBe(1);
    expect(late.find((l) => l.id === 1)!.opacity).toBeGreaterThan(0);
  });

  test('cada galaxia gira y se acerca muy despacio desde que aparece, sin cambiar de forma', () => {
    const s = nextPhase(galaxyReady(initialState(false), 1), 0);
    const a = layerStyles(s, 1000)[0]!;
    const b = layerStyles(s, 20000)[0]!;
    expect(Math.abs(b.rotate)).toBeGreaterThan(Math.abs(a.rotate));
    expect(Math.abs(b.rotate)).toBeLessThan(12); // degrees over a whole life: rigid and slow
    expect(b.scale).toBeGreaterThan(a.scale);
    expect(b.scale).toBeLessThan(1.08);
  });
});
