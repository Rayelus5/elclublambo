import { expect, test } from 'vitest';
import { agoText } from '../src/scanner/FindsTicker';
import { blipTiers, BLIPS } from '../src/scanner/SkyRadar';

// «Cielo vivo» and «Últimos hallazgos» (2026-11-17): the radar's blips follow the next scan's odds (and there is always
// a legendary to chase), and a find says how long ago it was in short Spanish.

test('los destellos del radar siguen las probabilidades, con al menos una legendaria', () => {
  const tiers = blipTiers([0.5, 0.28, 0.13, 0.06, 0.03, 0]);
  expect(tiers).toHaveLength(BLIPS);
  // 6 commons by the odds, one of them turned into the legendary to chase.
  expect(tiers.filter((t) => t === 'common')).toHaveLength(5);
  expect(tiers.filter((t) => t === 'legendary').length).toBeGreaterThanOrEqual(1);
  expect(tiers).not.toContain('mythic');
  // The rarest first (the outer places).
  expect(tiers[0]).toBe('legendary');
});

test('con la mítica abierta y suerte alta, salen más raras', () => {
  const tiers = blipTiers([0.2, 0.2, 0.2, 0.2, 0.15, 0.05]);
  expect(tiers).toHaveLength(BLIPS);
  expect(tiers).toContain('mythic');
});

test('hace cuánto, en corto', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  expect(agoText('2026-11-17T11:58:00Z', now)).toBe('hace 2 min');
  expect(agoText('2026-11-17T09:00:00Z', now)).toBe('hace 3 h');
  expect(agoText('2026-11-16T12:00:00Z', now)).toBe('ayer');
});
