import { activeLaser, angleTo, DEFAULT_CONTENT, IDLE, type Sim, step } from '@galaxy/sim';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { createStage, type Stage } from '../../src/arena/stage/stage';

let stage: Stage | null = null;
afterEach(() => {
  stage?.destroy();
  stage = null;
  document.body.innerHTML = '';
});

/** Colours seen on a sparse sample of the canvas: a real scene, not one flat colour. */
function distinctColours(canvas: HTMLCanvasElement): number {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
  return seen.size;
}

// Nov plan B4: the three new attacks on screen. The laser's warning (its line and the fan it will sweep), a closing
// ring with its way out, a walking barrage and then the beam itself, over a real run.
test('dibuja los avisos del láser, del anillo que se cierra y del bombardeo, y el haz del láser', async () => {
  const content = structuredClone(DEFAULT_CONTENT);
  const s = content.sectors[0]!;
  s.layerSeconds = 1;
  s.waves = [];
  s.density = { ...s.density, base: 0, perMinute: 0, max: 0 };
  content.bosses[0]!.phases = [
    { below: 1, interval: 0.5, telegraph: 0.3, speed: 0.01, patterns: [{ kind: 'laser', windup: 1, duration: 1.5, sweep: 90, length: 300, width: 12, damage: 1 }] },
  ];
  const sim: Sim = (await import('@galaxy/sim')).createSim({ seed: '9', content, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }] });
  const p = sim.probes[0]!;
  p.hp = 1e9;
  // Unarmed, so the Core shows its sprite and not its hit flash.
  p.weapons = [];
  await page.viewport(1280, 720);
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  document.body.appendChild(canvas);
  stage = await createStage(canvas, content, { reduced: false, vision: 0, probe: 0, seed: '9', preserve: true });
  stage.resize(1280, 720);
  for (let t = 0; t < 120 && !sim.boss; t++) step(sim, [IDLE]);
  // The Core close by, on screen.
  const b = sim.boss!.index;
  sim.enemies.x[b] = p.x + 150;
  sim.enemies.y[b] = p.y - 50;
  sim.enemies.px[b] = sim.enemies.x[b]!;
  sim.enemies.py[b] = sim.enemies.y[b]!;
  let warned = false;
  for (let t = 0; t < 240 && !warned; t++) {
    step(sim, [IDLE]);
    stage.feed(sim.events, sim.tick);
    warned = sim.events.some((e) => e.t === 'telegraph' && e.kind === 'laser');
  }
  expect(warned).toBe(true);
  // A closing ring around the probe and a barrage beside it, warned at the same time.
  const hole = angleTo(-1, 1);
  stage.feed([{ t: 'telegraph', kind: 'closing', x: p.x, y: p.y, angle: hole, ticks: 60, radius: 110, arc: 683 }], sim.tick);
  for (let k = 0; k < 6; k++) {
    stage.feed([{ t: 'telegraph', kind: 'explode', x: p.x - 160 + k * 40, y: p.y + 90, angle: 0, ticks: 40 + k * 10, radius: 24 }], sim.tick);
  }
  for (let t = 0; t < 30; t++) {
    step(sim, [IDLE]);
    stage.feed(sim.events, sim.tick);
  }
  stage.render(sim, 1);
  expect(distinctColours(canvas)).toBeGreaterThan(12);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/core-warnings.png', element: canvas });
  // The beam, halfway through its sweep.
  for (let t = 0; t < 120 && !(activeLaser(sim) && sim.boss!.active!.t < 45); t++) {
    step(sim, [IDLE]);
    stage.feed(sim.events, sim.tick);
  }
  expect(activeLaser(sim)).not.toBeNull();
  stage.render(sim, 1);
  expect(distinctColours(canvas)).toBeGreaterThan(12);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/core-beam.png', element: canvas });
}, 90_000);

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
