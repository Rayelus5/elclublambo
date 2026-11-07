import { ROOM_IDS } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { SPRITES } from '../src/arena/sprites';
import { roomSprite } from '../src/station/art';

// The station's art (GDD §10, DESIGN_SYSTEM §8 septies): every room has its scene working and broken, and the refinery
// and the antenna show their level (more tanks, more dishes), so the base grows in sight.

test('cada sala tiene su escena funcionando y rota, con dos fotogramas y del mismo tamaño', () => {
  for (const id of ROOM_IDS) {
    for (const state of ['working', 'broken'] as const) {
      const sprite = SPRITES[roomSprite(id, state, 1)];
      expect(sprite, `${id} ${state}`).toBeDefined();
      expect(sprite!.frames.length, `${id} ${state}`).toBeGreaterThanOrEqual(2);
      expect([sprite!.w, sprite!.h]).toEqual([40, 28]);
    }
  }
});

test('la refinería y la antena se ven distintas en cada nivel', () => {
  for (const id of ['refinery', 'antenna'] as const) {
    const ids = [1, 2, 3, 4, 5].map((level) => roomSprite(id, 'working', level));
    expect(new Set(ids).size, id).toBe(5);
    for (const s of ids) expect(SPRITES[s], s).toBeDefined();
  }
});

test('una sala rota no se parece a la que funciona', () => {
  for (const id of ROOM_IDS) {
    const on = SPRITES[roomSprite(id, 'working', 1)]!.frames[0]!.join('');
    const off = SPRITES[roomSprite(id, 'broken', 1)]!.frames[0]!.join('');
    expect(on, id).not.toBe(off);
  }
});
