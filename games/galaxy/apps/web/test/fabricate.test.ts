import { expect, test } from 'vitest';
import { fabricatePulls, REHEARSAL_PRESETS } from '../src/scanner/pro/fabricate';

// The Ensayo's scans (plan «escáner pro», part B): real galaxies of the asked tiers, made in the browser with the
// game's own generator (nothing is paid, nothing is saved), with the finish, «Destacada» and phenomenon asked for.

test('inventa galaxias reales de las rarezas pedidas, con la forma de una tirada', async () => {
  const pulls = await fabricatePulls({ tiers: ['common', 'rare', 'uncommon'], finish: 'holo', featured: [1], phenomenon: 'comet' }, 12345n);
  expect(pulls.map((p) => p.tier)).toEqual(['common', 'rare', 'uncommon']);
  for (const p of pulls) {
    expect(p.id).toMatch(/^ensayo-/);
    expect(p.seed).toMatch(/^\d+$/);
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.designation).toMatch(/^GX-/);
    expect(p.finish).toBe('holo');
    expect(p.traits['phenomenon']).toBe('comet');
  }
  expect(pulls.map((p) => p.featured)).toEqual([false, true, false]);
  // The same seed, the same scan.
  const again = await fabricatePulls({ tiers: ['common', 'rare', 'uncommon'], finish: 'holo', featured: [1], phenomenon: 'comet' }, 12345n);
  expect(again.map((p) => p.seed)).toEqual(pulls.map((p) => p.seed));
});

test('los preajustes de diez tienen diez rarezas', () => {
  for (const preset of Object.values(REHEARSAL_PRESETS)) expect(preset).toHaveLength(10);
  expect(REHEARSAL_PRESETS.variada).toContain('legendary');
});
