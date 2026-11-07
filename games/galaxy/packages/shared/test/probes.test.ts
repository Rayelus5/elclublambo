import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseConfig, PROBE_TEST, probeStatus, type RunStats, scoreTest, STARTERS } from '../src/index';

// The probe test and the unlocks (GDD §6): five questions with three answers give one of the three starting probes,
// a sixth breaks a tie; the other probes are earned by playing.

const cfg = parseConfig('probes', {});
/** The answer index that gives `probe` in question `q`. */
const pick = (q: number, probe: string) => PROBE_TEST.questions[q]!.answers.indexOf(probe as never);

describe('el test de la sonda', () => {
  test('cinco preguntas de tres respuestas, cada respuesta para una inicial, y la de desempate', () => {
    expect(STARTERS).toEqual(['lumen', 'bastion', 'spark']);
    expect(PROBE_TEST.questions).toHaveLength(5);
    for (const q of [...PROBE_TEST.questions, PROBE_TEST.tiebreak]) expect([...q.answers].sort()).toEqual([...STARTERS].sort());
  });

  test('cada perfil sale cuando gana sus respuestas', () => {
    for (const probe of STARTERS) expect(scoreTest([0, 1, 2, 3, 4].map((q) => pick(q, probe)))).toEqual({ probe });
    expect(scoreTest([pick(0, 'spark'), pick(1, 'spark'), pick(2, 'spark'), pick(3, 'lumen'), pick(4, 'bastion')])).toEqual({ probe: 'spark' });
  });

  test('un empate a dos o a tres pide el desempate, y la respuesta de desempate decide', () => {
    const two = [pick(0, 'lumen'), pick(1, 'lumen'), pick(2, 'bastion'), pick(3, 'bastion'), pick(4, 'spark')];
    expect(scoreTest(two)).toEqual({ tie: ['lumen', 'bastion'] });
    expect(scoreTest([...two, PROBE_TEST.tiebreak.answers.indexOf('bastion')])).toEqual({ probe: 'bastion' });
    expect(scoreTest([...two, PROBE_TEST.tiebreak.answers.indexOf('spark')])).toEqual({ probe: 'spark' });
  });

  test('respuestas de más, de menos o fuera de rango se rechazan', () => {
    expect(() => scoreTest([0, 1, 2, 0])).toThrow('bad_answers');
    expect(() => scoreTest([0, 1, 2, 0, 1, 2, 0])).toThrow('bad_answers');
    expect(() => scoreTest([0, 1, 2, 0, 3])).toThrow('bad_answers');
    expect(() => scoreTest([0, 1, 2, 0, 1.5])).toThrow('bad_answers');
  });

  test('con 5 respuestas y el desempate siempre sale una de las tres iniciales', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 6, maxLength: 6 }), (answers) => {
        const r = scoreTest(answers);
        return 'probe' in r && (STARTERS as readonly string[]).includes(r.probe);
      }),
      { numRuns: 300 },
    );
  });
});

describe('desbloqueos', () => {
  const none: RunStats = { runs: 0, bossKills: 0, maxDepth: 0, extractions: 0, kills: 0 };

  test('la sonda del test está desbloqueada desde el principio', () => {
    expect(probeStatus('bastion', 'bastion', none, cfg)).toEqual({ unlocked: true, condition: null, progress: 1 });
  });

  test('las otras dos iniciales piden 3 incursiones terminadas', () => {
    expect(probeStatus('lumen', 'bastion', none, cfg)).toEqual({ unlocked: false, condition: { stat: 'runs', value: 3 }, progress: 0 });
    expect(probeStatus('lumen', 'bastion', { ...none, runs: 2 }, cfg).progress).toBeCloseTo(2 / 3, 9);
    expect(probeStatus('lumen', 'bastion', { ...none, runs: 3 }, cfg).unlocked).toBe(true);
  });

  test('cada sonda se desbloquea al llegar a su umbral, no antes', () => {
    const cases: [string, keyof RunStats, number][] = [
      ['sentinel', 'bossKills', 3],
      ['anchor', 'maxDepth', 4],
      ['prism', 'extractions', 5],
      ['comet', 'kills', 2000],
      ['echo', 'runs', 15],
    ];
    for (const [probe, stat, value] of cases) {
      expect(probeStatus(probe, 'lumen', { ...none, [stat]: value - 1 }, cfg).unlocked, probe).toBe(false);
      expect(probeStatus(probe, 'lumen', { ...none, [stat]: value }, cfg), probe).toEqual({ unlocked: true, condition: { stat, value }, progress: 1 });
    }
  });

  test('una sonda sin condición en la configuración no se puede conseguir', () => {
    expect(probeStatus('nope', 'lumen', { ...none, runs: 999 }, cfg)).toEqual({ unlocked: false, condition: null, progress: 0 });
  });
});
