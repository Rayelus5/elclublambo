import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';

// Review of part C1 (plan «skins»): a reward that gives an avatar or a probe skin says so in words, in the Catálogo,
// the season route and the missions and events (they gave nothing in words before: a reward of only a skin was blank).

const none = { coins: 0, dust: 0, signal: 0, title: null, frame: null, avatar: null, skin: null };

test('el Catálogo y la ruta de temporada nombran el avatar y la skin que dan', () => {
  expect(copy.catalog.reward({ ...none, skin: 'skin-lumen-coral' })).toBe('la skin Lumen de coral');
  expect(copy.catalog.reward({ ...none, signal: 5, avatar: 'cartographer' })).toBe('5 señales, el avatar La Cartógrafa');
  expect(copy.season.reward({ ...none, shards: 30, skin: 'skin-comet-chatarra' }, 'esquirlas')).toBe('30 esquirlas, la skin Cometa de chatarra');
});

test('misiones y metas de evento nombran el avatar y la skin', () => {
  expect(copy.missions.reward.skin('Lumen de coral')).toBe('la skin Lumen de coral');
  expect(copy.missions.reward.avatar('La Cartógrafa')).toBe('el avatar La Cartógrafa');
});
