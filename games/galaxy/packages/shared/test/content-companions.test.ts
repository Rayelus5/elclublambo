import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { companionWarnings, parseConfig } from '../src/index';

// What a new sector or probe needs from other keys (the content editor, 2026-11-16, P7): an unlock and a pay rate for
// a sector, an unlock for a probe, and the season's sector named as the season's. Warnings shown before publishing.

const sectors = parseConfig('sectors', {});
const probes = parseConfig('probes', {});

test('lo publicado por defecto no tiene avisos', () => {
  expect(companionWarnings({ content: DEFAULT_CONTENT, live: DEFAULT_CONTENT, sectors, probes })).toEqual([]);
});

test('un sector nuevo sin desbloqueo ni paga, y una sonda nueva sin desbloqueo', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.sectors.splice(1, 0, { ...structuredClone(c.sectors[1]!), id: 'nuevo', name: 'Nuevo' });
  c.probes.push({ ...structuredClone(c.probes[0]!), id: 'nueva', name: 'Nueva' });
  const found = companionWarnings({ content: c, live: DEFAULT_CONTENT, sectors, probes }).map((w) => `${w.code}@${w.path}`);
  expect(found).toEqual(['sector_no_unlock@sectors.1', 'sector_no_pay@sectors.1', `probe_no_unlock@probes.${c.probes.length - 1}`]);
});

test('un sector de temporada nuevo que no es el de la temporada viva', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.sectors.push({ ...structuredClone(c.sectors.find((s) => s.season)!), id: 'otra-fisura', name: 'Otra fisura' });
  const found = companionWarnings({ content: c, live: DEFAULT_CONTENT, sectors, probes });
  expect(found.map((w) => `${w.code}@${w.path}`)).toEqual([`season_sector_not_live@sectors.${c.sectors.length - 1}`]);
});
