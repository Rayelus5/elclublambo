import { parseConfig } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { cosmeticsToGrant } from '../../src/cosmetics/everything';

// `grant-cosmetics` (CLI): every piece a player can own, or only the shop's. «Everything» reads the cosmetics catalog
// and every reward of the live config (achievements, missions, events, the album, the season route and shop), so a
// title an event gives counts though the catalog does not list it. Default pieces are everyone's already.

const cosmetics = parseConfig('cosmetics', {});
const shop = parseConfig('shop', {});
const event = { list: [{ id: 'e1', goals: [{ id: 'g1', reward: { signal: 0, points: 0, title: 'Héroe del evento', frame: null, avatar: null } }] }] };
const sources = { cosmetics, shopProducts: shop.products, rewards: [parseConfig('achievements', {}), parseConfig('seasonRoute', {}), event] };

test('--shop: las piezas de la tienda (catálogo y productos), nada de recompensas ni de serie', () => {
  const got = cosmeticsToGrant(sources, 'shop');
  expect(got.avatars).toEqual(['shop-nebula-queen', 'shop-void-knight', 'shop-star-fox', 'shop-comet-rider']);
  expect(got.frames).toEqual(['prism', 'solar', 'eclipse', 'starlight']);
  expect(got.titles).toEqual(['Mecenas estelar', 'Pionero del ECN', 'Guardián de la nebulosa', 'Viajero del vacío']);
});

test('--all: también lo que se gana jugando, en eventos y en la temporada; nunca lo de serie', () => {
  const got = cosmeticsToGrant(sources, 'all');
  expect(got.titles).toEqual(expect.arrayContaining(['Mecenas estelar', 'Héroe del evento', 'Cazador de estática', 'Leyenda de la Temporada 1']));
  expect(got.frames).toEqual(expect.arrayContaining(['prism', 'abyss', 'nebula']));
  expect(got.avatars).toEqual(expect.arrayContaining(['shop-star-fox', ...cosmetics.avatars.filter((a) => a.source === 'reward').map((a) => a.id)]));
  const defaults: string[] = [...cosmetics.avatars, ...cosmetics.frames].filter((x) => x.source === 'default').map((x) => x.id);
  expect([...got.avatars, ...got.frames].filter((id) => defaults.includes(id))).toEqual([]);
  // Each piece once.
  expect(new Set(got.titles).size).toBe(got.titles.length);
});
