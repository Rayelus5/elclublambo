import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { eventName } from '../src/arena/event-names';
import { codexEntries } from '../src/codex/entries';
import { coreRadio, sectorRadio } from '../src/codex/texts';
import { copy } from '../src/copy/es';

// The texts tied to an id (P8): the content's own first, the game's as they always were when it has none.

test('el Códice usa el texto del contenido y, si no hay, el de siempre', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  const before = codexEntries(c).find((e) => e.id === `sector-${c.sectors[1]!.id}`)!.text;
  c.sectors[1]!.lore = 'Otro texto';
  c.bosses[0]!.lore = 'Un Núcleo distinto';
  const entries = codexEntries(c);
  expect(before).not.toBe('Otro texto');
  expect(entries.find((e) => e.id === `sector-${c.sectors[1]!.id}`)!.text).toBe('Otro texto');
  expect(entries.find((e) => e.id === `core-${c.bosses[0]!.id}`)!.text).toBe('Un Núcleo distinto');
  const beast = c.enemies.find((e) => entries.some((x) => x.id === `beast-${e.id}`))!;
  beast.lore = 'Una bestia distinta';
  expect(codexEntries(c).find((e) => e.id === `beast-${beast.id}`)!.text).toBe('Una bestia distinta');
});

test('PERKINS dice la línea del contenido y, si no hay, la de siempre', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  expect(sectorRadio(c, 'frost-rings')).toBe(copy.arena.radio.sectors['frost-rings']);
  c.sectors.find((s) => s.id === 'frost-rings')!.radio = 'PERKINS: nuevo';
  expect(sectorRadio(c, 'frost-rings')).toBe('PERKINS: nuevo');
  expect(coreRadio(c, 'glacier')).toBe(copy.arena.radio.bosses['glacier']);
  c.bosses.find((b) => b.id === 'glacier')!.radio = 'PERKINS: frío';
  expect(coreRadio(c, 'glacier')).toBe('PERKINS: frío');
});

test('un peligro lleva el nombre que le da su sector en el contenido', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  expect(eventName('meteors', 'frost-rings', c)).toBe(copy.arena.events.bySector['frost-rings']!.meteors);
  c.sectors.find((s) => s.id === 'frost-rings')!.hazardNames = { meteors: 'Lluvia de agujas' };
  expect(eventName('meteors', 'frost-rings', c)).toBe('Lluvia de agujas');
  expect(eventName('storm', 'frost-rings', c)).toBe(copy.arena.events.bySector['frost-rings']!.storm);
});
