import { DEFAULT_CONTENT } from '@galaxy/sim';
import { test } from 'vitest';
import { page } from 'vitest/browser';

// Nov plan B4: the review sheet of every Core's three forms (both frames at 4×, nearest neighbour, named), for the owner
// to approve the art before the content is published. Only with VITE_ARENA_SHOTS=1; it saves __shots__/bosses-sheet.png.

test.skipIf(!import.meta.env['VITE_ARENA_SHOTS'])('hoja de los Núcleos y sus tres formas a 4×', async () => {
  const { SPRITES, rasterize } = await import('../../src/arena/sprites');
  const C = DEFAULT_CONTENT;
  // One row per Core: the sectors' cycles in order, then the deep Core's.
  const rows = [...C.sectors.map((s) => s.bossCycle ?? [s.boss]), C.sectors.find((s) => s.deepBoss)?.deepBoss?.cycle ?? []];
  await page.viewport(1240, 1400);
  const sheet = document.createElement('div');
  sheet.style.cssText = 'display:grid;grid-template-columns:repeat(3,auto);gap:14px 22px;padding:16px;background:#070a1c;width:max-content;font:600 14px system-ui,sans-serif;color:#f3f5ff';
  for (const cycle of rows) {
    cycle.forEach((id, k) => {
      const boss = C.bosses.find((b) => b.id === id)!;
      const def = SPRITES[boss.sprite]!;
      const cell = document.createElement('figure');
      cell.style.cssText = 'margin:0;display:flex;flex-direction:column;align-items:center;gap:6px';
      const frames = document.createElement('div');
      frames.style.cssText = 'display:flex;gap:6px;background:#141630;padding:4px';
      for (let f = 0; f < def.frames.length; f++) {
        const c = rasterize(def, f, 4);
        c.style.imageRendering = 'pixelated';
        frames.appendChild(c);
      }
      const label = document.createElement('figcaption');
      label.textContent = `${boss.name} · forma ${k + 1}`;
      const small = document.createElement('small');
      small.textContent = ` ${boss.id}`;
      small.style.color = '#8890c4';
      label.appendChild(small);
      cell.append(frames, label);
      sheet.appendChild(cell);
    });
  }
  document.body.appendChild(sheet);
  await page.screenshot({ path: '__shots__/bosses-sheet.png', element: sheet });
});
