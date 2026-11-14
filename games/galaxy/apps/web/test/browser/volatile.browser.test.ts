import { createSim, dealDamage, DEFAULT_CONTENT, IDLE, type Sim, spawnEnemy, step } from '@galaxy/sim';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { createStage, type Stage } from '../../src/arena/stage/stage';

// The volatile elite's blast on screen (the owner, 2026-11-14: «no hay ninguna animación de partículas de explosión … y es
// bastante confuso»): its fuse warns with its whole reach, bold and filling up; it goes off with a flash, a shockwave out
// to its reach and sparks; and it leaves the probe standing. Screenshots with VITE_ARENA_SHOTS=1.

let stage: Stage | null = null;
afterEach(() => {
  stage?.destroy();
  stage = null;
  document.body.innerHTML = '';
});

const frame = () => new Promise((r) => setTimeout(r, 16));

/** How many sampled pixels are warm (red, orange, yellow over the dark sky): the warning and the blast are. */
function warmPixels(canvas: HTMLCanvasElement): number {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
  let warm = 0;
  for (let i = 0; i < data.length; i += 4 * 13) if (data[i]! > 60 && data[i]! > data[i + 2]! + 25 && data[i]! > data[i + 1]! + 10) warm++;
  return warm;
}

test('el élite Inestable avisa con todo su alcance, estalla con destello y onda, y deja en pie a la sonda', async () => {
  const content = structuredClone(DEFAULT_CONTENT);
  const s = content.sectors[0]!;
  s.waves = [];
  s.density = { ...s.density, base: 0, perMinute: 0, max: 0 };
  const sim: Sim = createSim({ seed: '9', content, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }] });
  const p = sim.probes[0]!;
  // Unarmed and quiet: only the blast on screen.
  p.weapons = [];
  await page.viewport(1280, 720);
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  document.body.appendChild(canvas);
  stage = await createStage(canvas, content, { reduced: false, vision: 0, probe: 0, seed: '9', preserve: true });
  stage.resize(1280, 720);
  for (let t = 0; t < 10; t++) step(sim, [IDLE]);
  stage.render(sim, 1);
  const before = warmPixels(canvas);
  const mite = sim.content.enemies.find((e) => e.id === 'mite')!;
  const volatile = sim.content.elites.find((e) => e.id === 'volatile')!;
  const e = spawnEnemy(sim, mite, p.x + 36, p.y + 10, { elite: volatile });
  sim.enemies.speed[e] = 0;
  dealDamage(sim, e, 1000, { probe: 0, weapon: null, relic: null, element: null });
  stage.feed(sim.events, sim.tick);
  // Most of the fuse burnt: the warning is drawn bold and mostly filled.
  for (let t = 0; t < 54; t++) {
    step(sim, [IDLE]);
    stage.feed(sim.events, sim.tick);
  }
  stage.render(sim, 1);
  expect(warmPixels(canvas)).toBeGreaterThan(before + 20);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/volatile-fuse.png', element: canvas });
  // It goes off.
  let blasted = false;
  for (let t = 0; t < 40 && !blasted; t++) {
    step(sim, [IDLE]);
    stage.feed(sim.events, sim.tick);
    blasted = sim.events.some((ev) => ev.t === 'blast');
  }
  expect(blasted).toBe(true);
  stage.render(sim, 1);
  await frame();
  stage.render(sim, 1);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/volatile-flash.png', element: canvas });
  for (let k = 0; k < 3; k++) {
    stage.render(sim, 1);
    await frame();
  }
  stage.render(sim, 1);
  expect(warmPixels(canvas)).toBeGreaterThan(before + 20);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/volatile-blast.png', element: canvas });
  expect(p.alive).toBe(true);
  expect(p.hp).toBeLessThan(p.stats.maxHp);
}, 60_000);
