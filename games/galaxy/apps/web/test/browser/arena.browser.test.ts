import { coopRulesOf, parseConfig } from '@galaxy/shared';
import { botInput, botPick, createSim, damageProp, DEFAULT_CONTENT, dropPickup, IDLE, PICKUP, type Sim, spawnBoss, spawnEnemy, step } from '@galaxy/sim';
import { BlurFilter } from 'pixi.js';
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
  const tail: { ev: Sim['events']; tick: number }[] = [];
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
    else step(sim, [botInput(sim, 0, 99)]);
    if (sim.tick > ticks - 20) tail.push({ ev: [...sim.events], tick: sim.tick });
  }
  return { sim, feed: (s) => tail.forEach(({ ev, tick }) => s.feed(ev, tick)) };
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

test('el fondo queda tras un velo oscuro y desenfocado; lo que se juega, encima y nítido', async () => {
  const { sim, feed } = played(30 * 60);
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '20261107', preserve: true });
  stage.resize(1280, 720);
  feed(stage);
  stage.render(sim, 1);
  const root = stage.app.stage;
  const backdrop = root.getChildByLabel('backdrop')!;
  const veil = root.getChildByLabel('veil')!;
  const world = root.getChildByLabel('world')!;
  // The starfield and the nebula are blurred; nothing that is played is.
  expect(backdrop.filters).toEqual([expect.any(BlurFilter)]);
  expect(world.filters ?? []).toHaveLength(0);
  // The veil lies between them and covers the whole view, also after a resize.
  expect(root.getChildIndex(backdrop)).toBeLessThan(root.getChildIndex(veil));
  expect(root.getChildIndex(veil)).toBeLessThan(root.getChildIndex(world));
  expect(veil.getBounds()).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
  stage.resize(1600, 900);
  stage.render(sim, 1);
  expect(veil.getBounds()).toMatchObject({ width: 1600, height: 900 });
  expect(distinctColours(canvas)).toBeGreaterThan(12);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/arena-veil.png', element: canvas });
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
    stage.feed(sim.events, sim.tick);
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

test('al morir un enemigo marcado o aturdido no quedan su gota ni sus estrellas', async () => {
  const sim = createSim({ seed: '3', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }] });
  const dummy = DEFAULT_CONTENT.enemies[0]!;
  const ids = [0, 1, 2, 3].map((k) => spawnEnemy(sim, dummy, 40 + k * 20, 0));
  for (const e of ids) {
    sim.enemies.mark[e] = 1;
    sim.enemies.markT[e] = 120;
    sim.enemies.freezeT[e] = 120;
  }
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '3', preserve: true });
  stage.resize(1280, 720);
  stage.render(sim, 1);
  const layer = stage.app.stage.getChildByLabel('enemies', true)!;
  expect(layer.children.filter((c) => c.visible).length).toBeGreaterThan(4);
  for (const e of ids) sim.enemies.kill(e);
  stage.render(sim, 1);
  expect(layer.children.filter((c) => c.visible)).toHaveLength(0);
}, 60_000);

// M3b-3: every sector's ground, with its fauna around the probe and its Core firing, so the biome and the new warnings
// (lances, blink marks, mines, support pulses) are on screen.
for (const sector of DEFAULT_CONTENT.sectors) {
  test(`el bioma de ${sector.name}: su suelo, su fauna, su Núcleo y sus avisos`, async () => {
    const sim = createSim({ seed: '3', content: DEFAULT_CONTENT, sector: sector.id, probes: [{ probe: 'lumen', relics: [] }] });
    sim.probes[0]!.hp = 1e9;
    const species = [...new Set(sector.spawns.map((sp) => sp.enemy))];
    species.forEach((id, k) => {
      const def = DEFAULT_CONTENT.enemies.find((e) => e.id === id)!;
      for (let j = 0; j < 2; j++) {
        const a = ((k * 2 + j) / (species.length * 2)) * Math.PI * 2;
        spawnEnemy(sim, def, Math.cos(a) * 150, Math.sin(a) * 110);
      }
    });
    spawnBoss(sim);
    const tail: { ev: Sim['events']; tick: number }[] = [];
    for (let t = 0; t < 4 * 60; t++) {
      step(sim, [{ mx: 0, my: 0, aim: -1, pick: -1 }]);
      if (t > 3 * 60) tail.push({ ev: [...sim.events], tick: sim.tick });
    }
    // SIM 1.7.0: every pickup on the ground in a row (so the review sees them against this biome), and a breakable
    // prop at half life (its red bar and cracks).
    const p0 = sim.probes[0]!;
    const drops: [number, number, number][] = [];
    [
      [PICKUP.xp, 1],
      [PICKUP.xp, 5],
      [PICKUP.xp, 25],
      [PICKUP.coin, 1],
      [PICKUP.dust, 1],
      [PICKUP.repair, 1],
      [PICKUP.magnet, 1],
      [PICKUP.component, 1],
    ].forEach(([kind, value], k) => drops.push([kind!, value!, k]));
    // The camera goes to the nearest prop (so the shot always has one), which is left at half life.
    let near = -1;
    for (let i = 0; i < sim.props.top; i++) {
      if (!sim.props.alive[i]) continue;
      if (near < 0 || Math.hypot(sim.props.x[i]!, sim.props.y[i]!) < Math.hypot(sim.props.x[near]!, sim.props.y[near]!)) near = i;
    }
    if (near >= 0) {
      damageProp(sim, near, sim.props.hp[near]! * 0.55, 0);
      p0.x = p0.px = sim.props.x[near]! - 90;
      p0.y = p0.py = sim.props.y[near]! - 40;
      // Past its hit flash.
      sim.props.flashT[near] = 0;
    }
    for (const [kind, value, k] of drops) dropPickup(sim, kind, value, p0.x - 70 + k * 20, p0.y + 60);
    const canvas = await mount(1280, 720);
    stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '3', preserve: true, biome: sector.biome });
    stage.resize(1280, 720);
    tail.forEach(({ ev, tick }) => stage!.feed(ev, tick));
    stage.render(sim, 1);
    expect(distinctColours(canvas)).toBeGreaterThan(20);
    if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: `__shots__/biome-${sector.id}.png`, element: canvas });
  }, 90_000);
}

test('el lienzo deja el cursor al juego: al pasar el ratón, PixiJS no le escribe un cursor propio (la mira de Ajustes se ve en la partida)', async () => {
  const canvas = await mount(640, 360);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '20261107' });
  canvas.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100, pointerType: 'mouse' }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 110, pointerType: 'mouse' }));
  expect(canvas.style.cursor).toBe('');
});

test('la rueda acerca la vista a pasos enteros hasta el doble de cerca y vuelve; nunca ve más que la vista de siempre', async () => {
  const { sim, feed } = played(10 * 60);
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: true, vision: 0, probe: 0, seed: '20261107', preserve: true, zoom: 1 });
  stage.resize(1280, 720);
  feed(stage);
  stage.render(sim, 1);
  expect(stage.camera()).toMatchObject({ zoom: 3, worldH: 240 });
  stage.zoom(5);
  stage.render(sim, 1);
  expect(stage.zoomLevel()).toBe(2);
  expect(stage.camera()!.zoom).toBe(4);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/arena-zoom-4.png', element: canvas });
  stage.zoom(-9);
  stage.render(sim, 1);
  expect(stage.zoomLevel()).toBe(0);
  expect(stage.camera()!.zoom).toBe(2);
}, 90_000);

test('con movimiento, el zoom se desliza unos fotogramas hasta su paso entero', async () => {
  const { sim, feed } = played(10 * 60);
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '20261107', preserve: true });
  stage.resize(1280, 720);
  feed(stage);
  stage.render(sim, 1);
  stage.zoom(1);
  await new Promise((r) => setTimeout(r, 30));
  stage.render(sim, 1);
  const mid = stage.camera()!.zoom;
  expect(mid).toBeGreaterThan(2);
  expect(mid).toBeLessThan(3);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 16));
    stage.render(sim, 1);
  }
  expect(stage.camera()!.zoom).toBe(3);
}, 90_000);

// Arrows towards teammates off screen (Nov plan A2): one far to the right in its team colour, one down far to the left.
test('en grupo, los compañeros fuera de pantalla tienen su flecha en el borde', async () => {
  const sim = createSim({
    seed: '20261112',
    content: DEFAULT_CONTENT,
    sector: 'outer-nebula',
    probes: [
      { probe: 'lumen', relics: [] },
      { probe: 'lumen', relics: [] },
      { probe: 'lumen', relics: [] },
    ],
    coop: coopRulesOf(parseConfig('coop', {})),
  });
  step(sim, [IDLE, IDLE, IDLE]);
  const [me, right, left] = sim.probes;
  right!.x = right!.px = me!.x + 1500;
  right!.y = right!.py = me!.y;
  left!.x = left!.px = me!.x - 1500;
  left!.y = left!.py = me!.y;
  left!.life = 'down';
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: true, vision: 0, probe: 0, me: 0, seed: '20261112', preserve: true, names: ['yo', 'vega', 'orion'] });
  stage.resize(1280, 720);
  stage.render(sim, 1);
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = 1280;
  ctx.canvas.height = 720;
  ctx.drawImage(canvas, 0, 0);
  const near = (x0: number, x1: number, rgb: [number, number, number]) => {
    const data = ctx.getImageData(x0, 300, x1 - x0, 120).data;
    for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i]! - rgb[0]) < 40 && Math.abs(data[i + 1]! - rgb[1]) < 40 && Math.abs(data[i + 2]! - rgb[2]) < 40) return true;
    return false;
  };
  // Team tint of slot 1 (Terminal green) at the right edge; a fallen teammate's arrow in red at the left edge.
  expect(near(1180, 1280, [0x45, 0xe3, 0xa6])).toBe(true);
  expect(near(0, 100, [0xff, 0x4d, 0x6d])).toBe(true);
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/coop-mates-1280.png', element: canvas });
}, 90_000);

// The arrows keep out of the HUD's bands (Nov plan A review): a teammate straight above sits below the top bar.
test('la flecha de un compañero justo encima queda debajo de la barra de arriba', async () => {
  const sim = createSim({ seed: '20261113', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }, { probe: 'lumen', relics: [] }], coop: coopRulesOf(parseConfig('coop', {})) });
  step(sim, [IDLE, IDLE]);
  const [me, up] = sim.probes;
  up!.x = up!.px = me!.x;
  up!.y = up!.py = me!.y - 1500;
  const canvas = await mount(1280, 720);
  stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: true, vision: 0, probe: 0, me: 0, seed: '20261113', preserve: true, names: ['yo', 'vega'] });
  stage.resize(1280, 720);
  stage.setInsets({ top: 100, right: 0, bottom: 0, left: 0 });
  stage.render(sim, 1);
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = 1280;
  ctx.canvas.height = 720;
  ctx.drawImage(canvas, 0, 0);
  const green = (y0: number, y1: number) => {
    const data = ctx.getImageData(600, y0, 80, y1 - y0).data;
    for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i]! - 0x45) < 40 && Math.abs(data[i + 1]! - 0xe3) < 40 && Math.abs(data[i + 2]! - 0xa6) < 40) return true;
    return false;
  };
  expect(green(0, 100)).toBe(false);
  expect(green(100, 200)).toBe(true);
}, 90_000);
