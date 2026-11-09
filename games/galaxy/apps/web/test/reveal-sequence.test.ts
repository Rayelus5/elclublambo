import { TIERS, type PulledGalaxy, type Tier } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { GLITCH_FLASHES, revealSequence, skipToSummary } from '../src/scanner/reveal-sequence';

// The deep-field scan (GDD §9): static, signal bars, the scan in the rarity's colour, «Fenómeno detectado», the
// screen failing on a Legendary, the card — pull after pull — and a summary at the end that Saltar jumps to.
const pull = (tier: Tier, phenomenon = 'none', id: string = tier): PulledGalaxy => ({
  id,
  seed: '1',
  tier,
  finish: 'normal',
  traits: { galaxy_type: 'spiral', palette: 'solar_gold', phenomenon },
  name: id,
  designation: 'GX-000001',
  featured: false,
});
const kinds = (steps: ReturnType<typeof revealSequence>) => steps.map((s) => s.kind);

test('cada tirada pasa por estática, señal, escaneo y carta, y todo acaba en el resumen', () => {
  const steps = revealSequence([pull('common', 'none', 'a'), pull('rare', 'none', 'b')], { reduced: false });
  expect(kinds(steps)).toEqual(['static', 'signal', 'scan', 'card', 'static', 'signal', 'scan', 'card', 'summary']);
  expect(steps.filter((s) => s.kind === 'card').map((s) => s.index)).toEqual([0, 1]);
  expect(steps.at(-1)).toMatchObject({ kind: 'summary', ms: Infinity });
});

test('cuanto más rara, más barras de señal y un escaneo más lento', () => {
  const by = (kind: string) => TIERS.map((t) => revealSequence([pull(t)], { reduced: false }).find((s) => s.kind === kind)!);
  const signal = by('signal');
  const scan = by('scan');
  expect(signal.map((s) => s.bars)).toEqual([1, 2, 3, 4, 5]);
  for (let i = 1; i < TIERS.length; i++) {
    expect(signal[i]!.ms).toBeGreaterThan(signal[i - 1]!.ms);
    expect(scan[i]!.ms).toBeGreaterThan(scan[i - 1]!.ms);
  }
  expect(scan.map((s) => s.tier)).toEqual([...TIERS]);
});

test('un fenómeno se anuncia y una Legendaria hace fallar la pantalla antes de su carta', () => {
  expect(kinds(revealSequence([pull('epic', 'pulsar')], { reduced: false }))).toEqual(['static', 'signal', 'scan', 'phenomenon', 'card', 'summary']);
  const legendary = revealSequence([pull('legendary', 'supernova')], { reduced: false });
  expect(kinds(legendary)).toEqual(['static', 'signal', 'scan', 'phenomenon', 'glitch', 'card', 'summary']);
  expect(legendary.find((s) => s.kind === 'phenomenon')).toMatchObject({ phenomenon: 'supernova' });
});

test('el fallo de pantalla nunca destella más de tres veces por segundo', () => {
  const glitch = revealSequence([pull('legendary')], { reduced: false }).find((s) => s.kind === 'glitch')!;
  expect(GLITCH_FLASHES / (glitch.ms / 1000)).toBeLessThanOrEqual(3);
});

test('con movimiento reducido no hay fallo de pantalla y cada carta espera al jugador', () => {
  const steps = revealSequence([pull('legendary', 'comet'), pull('common')], { reduced: true });
  expect(kinds(steps)).not.toContain('glitch');
  expect(steps.filter((s) => s.kind === 'card').every((s) => s.ms === Infinity)).toBe(true);
  expect(steps.find((s) => s.kind === 'static')!.ms).toBeLessThan(revealSequence([pull('common')], { reduced: false })[0]!.ms);
});

test('en una tirada de diez las cartas siguen solas y la estática se acorta tras la primera', () => {
  const steps = revealSequence(Array.from({ length: 10 }, (_, i) => pull('common', 'none', `p${i}`)), { reduced: false });
  expect(steps.filter((s) => s.kind === 'card')).toHaveLength(10);
  expect(steps.filter((s) => s.kind === 'card').every((s) => Number.isFinite(s.ms))).toBe(true);
  const statics = steps.filter((s) => s.kind === 'static');
  expect(statics[1]!.ms).toBeLessThan(statics[0]!.ms);
});

test('una sola tirada espera al jugador en su carta', () => {
  const card = revealSequence([pull('rare')], { reduced: false }).find((s) => s.kind === 'card')!;
  expect(card.ms).toBe(Infinity);
});

test('saltar lleva al resumen desde cualquier paso', () => {
  const steps = revealSequence([pull('common'), pull('legendary')], { reduced: false });
  for (let i = 0; i < steps.length; i++) expect(steps[skipToSummary(steps)]!.kind).toBe('summary');
});

// Open beta: a run of ten moves on (the commons quickly), and the rare ones still take their time.
const total = (steps: ReturnType<typeof revealSequence>) => steps.filter((s) => Number.isFinite(s.ms)).reduce((n, s) => n + s.ms, 0);

test('una tirada de diez comunes llega al resumen en 22 s como mucho', () => {
  const ten = Array.from({ length: 10 }, (_, i) => pull('common', 'none', `c${i}`));
  expect(total(revealSequence(ten, { reduced: false }))).toBeLessThanOrEqual(22_000);
});

test('en una tirada de diez, la carta de una épica o una legendaria dura más que la de una común', () => {
  const steps = revealSequence([pull('common', 'none', 'a'), pull('epic', 'none', 'b'), pull('legendary', 'none', 'c')], { reduced: false });
  const card = (i: number) => steps.find((s) => s.kind === 'card' && s.index === i)!.ms;
  expect(card(1)).toBeGreaterThan(card(0));
  expect(card(2)).toBeGreaterThan(card(1));
});

test('una sola tirada mantiene su suspense: el escaneo de una legendaria no se acorta', () => {
  const one = revealSequence([pull('legendary')], { reduced: false });
  const inTen = revealSequence([pull('common', 'none', 'x'), pull('legendary', 'none', 'y')], { reduced: false });
  expect(one.find((s) => s.kind === 'scan')!.ms).toBeGreaterThanOrEqual(inTen.find((s) => s.kind === 'scan' && s.index === 1)!.ms);
});
