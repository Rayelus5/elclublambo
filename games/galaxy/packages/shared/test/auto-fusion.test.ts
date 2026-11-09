import { describe, expect, test } from 'vitest';
import { type AutoFusionCandidate, autoFusible, autoFusionCriteriaSchema, fusionOrder, keptBecause, planAutoFusion } from '../src/index';

// The automatic fusion's plan (multiplayer plan, phase 2): groups of `count` per tier, in a chain up to the top tier,
// while the dust lasts; it never takes what the player keeps.

const recipe = { count: 5, dust: [20, 50, 120, 300] };
const criteria = (over: Record<string, unknown> = {}) => autoFusionCriteriaSchema.parse({ from: 'common', upTo: 'epic', ...over });
let n = 0;
const g = (over: Partial<AutoFusionCandidate> = {}): AutoFusionCandidate => ({
  id: `g${String(n++).padStart(4, '0')}`,
  tier: 0,
  finish: 'normal',
  level: 1,
  score: 50,
  createdAt: '2026-11-01T00:00:00.000Z',
  locked: false,
  busy: false,
  type: 'spiral',
  palette: 'andromeda_blue',
  ...over,
});
const many = (k: number, over: Partial<AutoFusionCandidate> = {}) => Array.from({ length: k }, () => g(over));

describe('plan de la fusión automática', () => {
  test('25 comunes hasta épica: 5 fusiones a poco común y 1 a rara, en cadena', () => {
    const p = planAutoFusion(many(25), criteria(), recipe, 10_000);
    expect(p.steps).toEqual([
      { from: 'common', to: 'uncommon', fusions: 5, dust: 100 },
      { from: 'uncommon', to: 'rare', fusions: 1, dust: 50 },
    ]);
    expect(p.fusions).toBe(6);
    expect(p.dust).toBe(150);
    expect(p.short).toBe(false);
  });

  test('la cadena para en la rareza tope: hasta poco común no sube a rara', () => {
    const p = planAutoFusion(many(25), criteria({ upTo: 'uncommon' }), recipe, 10_000);
    expect(p.steps).toEqual([{ from: 'common', to: 'uncommon', fusions: 5, dust: 100 }]);
  });

  test('suma las galaxias que ya tienes de la rareza siguiente', () => {
    const p = planAutoFusion([...many(10), ...many(3, { tier: 1 })], criteria(), recipe, 10_000);
    // 10 comunes → 2 poco comunes; con las 3 que había, 5 → 1 rara.
    expect(p.steps.map((s) => s.fusions)).toEqual([2, 1]);
  });

  test('desde rara no toca comunes ni poco comunes', () => {
    const p = planAutoFusion([...many(10), ...many(10, { tier: 2 })], criteria({ from: 'rare' }), recipe, 10_000);
    expect(p.steps).toEqual([{ from: 'rare', to: 'epic', fusions: 2, dust: 240 }]);
  });

  test('protege candados, acabados especiales, niveles y lo ocupado, y lo cuenta', () => {
    const list = [...many(5), g({ locked: true }), g({ finish: 'holo' }), g({ level: 3 }), g({ busy: true })];
    const p = planAutoFusion(list, criteria(), recipe, 10_000);
    expect(p.fusions).toBe(1);
    expect(p.kept).toEqual({ busy: 1, locked: 1, finishes: 1, leveled: 1 });
  });

  test('con los interruptores apagados entran acabados y niveles, nunca candados', () => {
    const list = [...many(3), g({ finish: 'prismatic' }), g({ level: 4 }), g({ locked: true })];
    const p = planAutoFusion(list, criteria({ keepFinishes: false, keepLeveled: false }), recipe, 10_000);
    expect(p.fusions).toBe(1);
    expect(p.kept.locked).toBe(1);
  });

  test('los filtros de tipo, paleta y acabado acotan lo que entra', () => {
    const list = [...many(5, { type: 'spiral' }), ...many(5, { type: 'elliptical' })];
    expect(planAutoFusion(list, criteria({ type: 'elliptical' }), recipe, 10_000).fusions).toBe(1);
    expect(planAutoFusion(list, criteria({ palette: 'otra' }), recipe, 10_000).fusions).toBe(0);
  });

  test('se detiene cuando no llega el polvo y lo dice', () => {
    const p = planAutoFusion(many(25), criteria(), recipe, 70);
    expect(p.fusions).toBe(3);
    expect(p.dust).toBe(60);
    expect(p.short).toBe(true);
  });

  test('como mucho 100 fusiones por vez', () => {
    const p = planAutoFusion(many(600), criteria({ upTo: 'uncommon' }), recipe, 1_000_000);
    expect(p.fusions).toBe(100);
    expect(p.limited).toBe(true);
  });

  test('el rango ha de subir: desde épica hasta poco común no vale', () => {
    expect(autoFusionCriteriaSchema.safeParse({ from: 'epic', upTo: 'uncommon' }).success).toBe(false);
    expect(autoFusionCriteriaSchema.safeParse({ from: 'common', upTo: 'common' }).success).toBe(false);
  });
});

describe('qué entra y en qué orden', () => {
  test('autoFusible respeta rarezas, filtros y protecciones', () => {
    const c = criteria({ upTo: 'rare' });
    expect(autoFusible(g(), c)).toBe(true);
    expect(autoFusible(g({ tier: 2 }), c)).toBe(false);
    expect(autoFusible(g({ locked: true }), c)).toBe(false);
    expect(keptBecause(g({ busy: true, locked: true }), c)).toBe('busy');
  });

  test('se gastan primero las de menor puntuación y, a igualdad, las más antiguas', () => {
    const a = g({ score: 70 });
    const b = g({ score: 10, createdAt: '2026-11-03T00:00:00.000Z' });
    const c = g({ score: 10, createdAt: '2026-11-02T00:00:00.000Z' });
    expect(fusionOrder([a, b, c]).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
  });
});
