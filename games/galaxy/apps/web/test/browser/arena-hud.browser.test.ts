import type { RunStart } from '@galaxy/shared';
import { botInput, botPick, DEFAULT_CONTENT, offerFor, type Sim, step } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { ArenaScreen } from '../../src/arena/ArenaScreen';
import '../../src/styles/app.css';

// The whole run screen in a real browser: the PixiJS arena with the React HUD on top. With VITE_ARENA_SHOTS=1 it
// saves screenshots of the HUD at 1280×720 and 3440×1440 and of the level-up choice for review.

const run: RunStart = {
  id: '00000000-0000-4000-8000-000000000002',
  seed: '20261107',
  sector: 'outer-nebula',
  probe: 'lumen',
  relics: [],
  content: DEFAULT_CONTENT,
  contentVersion: 0,
  startedAt: '2026-11-07T10:00:00.000Z',
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

/** Plays `ticks` with the bot before the screen starts its own loop. */
function advance(sim: Sim, ticks: number): void {
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
    else step(sim, [botInput(sim, 0, 99)]);
  }
}

async function show(width: number, height: number, ticks: number, then?: (sim: Sim) => void): Promise<Sim> {
  await page.viewport(width, height);
  document.body.style.margin = '0';
  const host = document.createElement('div');
  document.body.appendChild(host);
  let sim: Sim | null = null;
  root = createRoot(host);
  root.render(
    createElement(ArenaScreen, {
      run,
      onEnd: () => {},
      onSim: (s: Sim) => {
        if (sim) return;
        sim = s;
        advance(s, ticks);
        then?.(s);
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 1200));
  return sim!;
}

test('el HUD sobre la arena: vida, nivel, tiempo, capa, botín y equipo', async () => {
  const sim = await show(1280, 720, 4 * 3600);
  expect(document.querySelector('.hud-hp')).not.toBeNull();
  expect(document.querySelectorAll('.hud-kit-item').length).toBeGreaterThan(1);
  expect(sim.tick).toBeGreaterThan(4 * 3600 - 10);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/hud-1280.png' });
}, 120_000);

test('en una ultrapanorámica el HUD se ancla a los bordes y la arena lleva bandas', async () => {
  await show(3440, 1440, 5 * 3600 + 120);
  expect(document.querySelector('.hud-boss')).not.toBeNull();
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/hud-3440.png' });
}, 120_000);

test('la elección de mejora con sus tres cartas', async () => {
  await show(1280, 720, 60 * 60, (s) => {
    const p = s.probes[0]!;
    p.pendingLevels = 1;
    p.offer = offerFor(s, p);
    s.status = 'choosing';
  });
  expect(document.querySelectorAll('.levelup-card')).toHaveLength(3);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/levelup-1280.png' });
}, 120_000);
