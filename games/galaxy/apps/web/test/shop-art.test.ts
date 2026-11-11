import { expect, test } from 'vitest';
import { artOf, canvasSizeOf, SPRITE, spriteFrame } from '../src/shop/art';

// The shop's pack art (shop and lab plan, F5c): the Aseprite set (art/shop/tienda-packs.aseprite) gives every currency
// pack its 84×84 sprite from one strip, coins 1–6, dust 1–6 and components 1–6; the bundles and the welcome pack keep
// the painted art until theirs are drawn.

test('cada pack de moneda, polvo o componentes tiene su fotograma de la tira, en orden', () => {
  expect(spriteFrame(artOf('coins-1', 'pack'))).toBe(0);
  expect(spriteFrame(artOf('coins-6', 'pack'))).toBe(5);
  expect(spriteFrame(artOf('dust-1', 'pack'))).toBe(6);
  expect(spriteFrame(artOf('dust-4', 'pack'))).toBe(9);
  expect(spriteFrame(artOf('components-1', 'pack'))).toBe(12);
  expect(spriteFrame(artOf('components-6', 'pack'))).toBe(17);
});

test('los combinados y el pack de bienvenida siguen pintados; los packs se dibujan a 84×84', () => {
  expect(spriteFrame(artOf('kit-explorador', 'bundle'))).toBeNull();
  expect(spriteFrame(artOf('', 'welcome'))).toBeNull();
  expect(SPRITE).toBe(84);
  expect(canvasSizeOf(artOf('dust-3', 'pack'), 44)).toBe(84);
  expect(canvasSizeOf(artOf('kit-arranque', 'bundle'), 44)).toBe(44);
});
