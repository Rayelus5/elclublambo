import { ROOM_IDS } from '@galaxy/shared';
import { afterEach, test } from 'vitest';
import { page } from 'vitest/browser';
import { rasterize, SPRITES } from '../../src/arena/sprites';
import { roomSprite } from '../../src/station/art';

// The station's art and screen in a real browser, for review screenshots (VITE_ARENA_SHOTS=1).

afterEach(() => {
  document.body.innerHTML = '';
});

test.skipIf(!import.meta.env['VITE_ARENA_SHOTS'])('hoja de las salas a 4×: funcionando, rotas y por nivel', async () => {
  await page.viewport(1400, 1300);
  const sheet = document.createElement('div');
  sheet.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;padding:12px;background:#070a1c;width:1376px';
  const add = (id: string) => {
    const c = rasterize(SPRITES[id]!, 0, 4);
    c.title = id;
    sheet.appendChild(c);
  };
  for (const id of ROOM_IDS) add(roomSprite(id, 'working', 1));
  for (const id of ROOM_IDS) add(roomSprite(id, 'broken', 1));
  for (const level of [2, 3, 4, 5]) add(roomSprite('refinery', 'working', level));
  for (const level of [2, 3, 4, 5]) add(roomSprite('antenna', 'working', level));
  document.body.appendChild(sheet);
  await page.screenshot({ path: '__shots__/station-rooms.png', element: sheet });
});
