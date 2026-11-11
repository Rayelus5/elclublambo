import { expect, test } from 'vitest';
import { artOf, SPRITE, spriteFrame } from '../src/shop/art';

// The shop's pack art (shop and lab plan, F5c): the Aseprite set (art/shop/tienda-packs.aseprite) gives every product
// its 84×84 sprite from one strip: coins 1–6, dust 1–6, components 1–6, then the welcome pack and the three kits.

test('cada pack de moneda, polvo o componentes tiene su fotograma de la tira, en orden', () => {
  expect(spriteFrame(artOf('coins-1', 'pack'))).toBe(0);
  expect(spriteFrame(artOf('coins-6', 'pack'))).toBe(5);
  expect(spriteFrame(artOf('dust-1', 'pack'))).toBe(6);
  expect(spriteFrame(artOf('dust-4', 'pack'))).toBe(9);
  expect(spriteFrame(artOf('components-1', 'pack'))).toBe(12);
  expect(spriteFrame(artOf('components-6', 'pack'))).toBe(17);
});

test('el pack de bienvenida y los tres kits van detrás; un combinado nuevo toma el kit de su tamaño', () => {
  expect(spriteFrame(artOf('', 'welcome'))).toBe(18);
  expect(spriteFrame(artOf('kit-arranque', 'bundle'))).toBe(19);
  expect(spriteFrame(artOf('kit-explorador', 'bundle'))).toBe(20);
  expect(spriteFrame(artOf('kit-comandante', 'bundle'))).toBe(21);
  expect(spriteFrame(artOf('pack-de-verano', 'bundle'))).toBe(19);
  expect(SPRITE).toBe(84);
});
