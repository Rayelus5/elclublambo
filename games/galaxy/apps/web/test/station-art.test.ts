import { ROOM_IDS, type RoomId } from '@galaxy/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ROOM_FRAMES, roomSheet, roomSheetUrl } from '../src/station/art';

// The station's art (GDD §10, DESIGN_SYSTEM §8 septies): rooms painted in Aseprite (art/station/paint-rooms.lua),
// exported as strips of four 64×44 frames. Every room has its scene working and broken, and the refinery and the
// antenna show their level, so the base grows in sight.

// Vitest runs from games/galaxy (jsdom's import.meta.url is not a file URL).
const dir = join(process.cwd(), 'apps/web/src/station/rooms');
/** Width and height from the PNG header. */
const size = (name: string) => {
  const b = readFileSync(join(dir, `${name}.png`));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const LEVELS = [1, 2, 3, 4, 5];

test('cada sala tiene su tira funcionando y rota: cuatro fotogramas de 64×44', () => {
  for (const id of ROOM_IDS) {
    for (const state of ['working', 'broken'] as const) {
      const name = roomSheet(id, state, 1);
      expect(roomSheetUrl(id, state, 1), name).toBeTruthy();
      expect(size(name), name).toEqual([64 * ROOM_FRAMES, 44]);
    }
  }
  expect(roomSheet('antenna', 'broken', 0)).toBe('antenna-broken');
});

test('la refinería y la antena tienen una tira por nivel', () => {
  for (const id of ['refinery', 'antenna'] as const) {
    const names = LEVELS.map((level) => roomSheet(id, 'working', level));
    expect(new Set(names).size, id).toBe(5);
    for (const name of names) expect(size(name), name).toEqual([256, 44]);
  }
  expect(roomSheet('refinery', 'working', 9)).toBe('refinery-5');
  expect(roomSheet('scanner', 'working', 3)).toBe('scanner');
});

test('no sobra ninguna tira: cada png de las salas es una variante que se usa', () => {
  const used = new Set([
    ...ROOM_IDS.flatMap((id) => [roomSheet(id, 'working', 1), roomSheet(id, 'broken', 1)]),
    ...(['refinery', 'antenna'] as RoomId[]).flatMap((id) => LEVELS.map((level) => roomSheet(id, 'working', level))),
  ]);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4));
  expect(new Set(files)).toEqual(used);
});
