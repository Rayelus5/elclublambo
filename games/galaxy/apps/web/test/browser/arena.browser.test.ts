import { botInput, botPick, createSim, DEFAULT_CONTENT, type Sim, step } from '@galaxy/sim';
import { afterEach, expect, test, vi } from 'vitest';
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

test('dibuja el arsenal: las 9 armas nuevas, marcas, aturdimiento, rotura y una reacción, sin avisos', async () => {
  const warn = vi.spyOn(console, 'warn');
  const content = structuredClone(DEFAULT_CONTENT);
  const sim = createSim({ seed: '7', content, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }] });
  const p = sim.probes[0]!;
  p.weapons = ['beam', 'cone', 'shards', 'homing', 'mine', 'boomerang'].map((id) => ({ id, level: 5, t: 0 }));
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, content, { reduced: false, vision: 0, probe: 0, seed: '7', preserve: true });
  stage.resize(1280, 720);
  /** Marks, stun and shatter on a few enemies, so the states are on screen. */
  const states = () => {
    const en = sim.enemies;
    for (let i = 0, k = 0; i < en.top && k < 9; i++) {
      if (!en.alive[i] || en.boss[i]) continue;
      if (k % 3 === 0) en.freezeT[i] = 60;
      if (k % 3 === 1) {
        en.vulnT[i] = 60;
        en.vulnBonus[i] = 0.4;
      }
      en.mark[i] = 1 + (k % 4);
      en.markT[i] = 60;
      k++;
    }
  };
  for (let t = 0; t < 40 * 60 && sim.status !== 'dead'; t++) {
    if (t === 20 * 60) {
      states();
      stage.render(sim, 1);
      expect(distinctColours(canvas)).toBeGreaterThan(12);
      if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/arsenal-a.png', element: canvas });
      p.weapons = ['field', 'strike', 'turret', 'ion-ray', 'solar-breath', 'pulse-storm'].map((id) => ({ id, level: 1, t: 0 }));
    }
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
    else step(sim, [botInput(sim, 0, 99)]);
    stage.feed(sim.events);
  }
  states();
  stage.feed([{ t: 'reaction', id: 'short-circuit', x: p.x + 40, y: p.y }]);
  stage.feed([{ t: 'evolve', probe: 0, from: 'beam', to: 'ion-ray' }]);
  stage.render(sim, 1);
  expect(distinctColours(canvas)).toBeGreaterThan(12);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/arsenal-b.png', element: canvas });
  // Destroy and create again: the fonts are uninstalled, so PixiJS has nothing to warn about.
  stage.destroy();
  stage = null;
  document.body.innerHTML = '';
  const again = await mount(1280, 720);
  stage = await createStage(again, content, { reduced: false, vision: 0, probe: 0, seed: '7', preserve: true });
  stage.render(sim, 1);
  expect(warn.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => m.includes('gs-dmg') || m.includes('gs-react'))).toEqual([]);
  warn.mockRestore();
}, 120_000);
