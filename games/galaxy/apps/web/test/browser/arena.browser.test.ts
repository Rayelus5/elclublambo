import { botInput, botPick, createSim, DEFAULT_CONTENT, type Sim, step } from '@galaxy/sim';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { createStage, type Stage } from '../../src/arena/stage/stage';

// The arena renderer in a real browser (WebGL via SwiftShader): it draws a played run without errors, the image is a
// real scene (not one flat colour), and with VITE_ARENA_SHOTS=1 it saves screenshots for review.

let stage: Stage | null = null;
afterEach(() => {
  stage?.destroy();
  stage = null;
  document.body.innerHTML = '';
});

function played(ticks: number): { sim: Sim; feed: (s: Stage) => void } {
  const sim = createSim({ seed: '20261107', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }] });
  const tail: Sim['events'][] = [];
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
    else step(sim, [botInput(sim, 0, 99)]);
    if (sim.tick > ticks - 20) tail.push([...sim.events]);
  }
  return { sim, feed: (s) => tail.forEach((ev) => s.feed(ev)) };
}

async function mount(width: number, height: number): Promise<HTMLCanvasElement> {
  await page.viewport(width, height);
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = 'block';
  document.body.appendChild(canvas);
  return canvas;
}

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

test('dibuja una partida jugada: fauna, disparos, botín y suelo', async () => {
  const { sim, feed } = played(90 * 60);
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '20261107', preserve: true });
  stage.resize(1280, 720);
  feed(stage);
  stage.render(sim, 1);
  expect(stage.camera()).toMatchObject({ zoom: 2, bars: 0 });
  expect(distinctColours(canvas)).toBeGreaterThan(12);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/arena-1280.png', element: canvas });
}, 90_000);

test('en una ultrapanorámica pone bandas y no amplía la vista', async () => {
  const { sim, feed } = played(4 * 60 * 60);
  const canvas = await mount(2560, 1080);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '20261107', preserve: true });
  stage.resize(2560, 1080);
  feed(stage);
  stage.render(sim, 1);
  expect(stage.camera()).toMatchObject({ zoom: 3, worldW: 840, bars: 20 });
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/arena-2560.png', element: canvas });
}, 120_000);

test.skipIf(!import.meta.env['VITE_ARENA_SHOTS'])('hoja de sprites a 4× para revisar el pixel art', async () => {
  const { SPRITES, rasterize } = await import('../../src/arena/sprites');
  await page.viewport(1400, 900);
  const sheet = document.createElement('div');
  sheet.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;padding:12px;background:#070a1c;width:1376px';
  for (const [id, def] of Object.entries(SPRITES)) {
    for (let f = 0; f < def.frames.length; f++) {
      const c = rasterize(def, f, 4);
      c.title = id;
      c.style.flex = 'none';
      sheet.appendChild(c);
    }
  }
  document.body.appendChild(sheet);
  await page.screenshot({ path: '__shots__/sprites.png', element: sheet });
});
