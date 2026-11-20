import type { RunStart } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, DEFAULT_COOP_RULES, offerFor, type Sim, spawnEnemy, step } from '@galaxy/sim';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import { ArenaScreen } from '../../apps/web/src/arena/ArenaScreen';
import { setArenaZoom } from '../../apps/web/src/arena/settings';
import { createStage } from '../../apps/web/src/arena/stage/stage';
import '../../apps/web/src/styles/app.css';
import { hold, installVirtualTime, press, record, type VirtualTime } from './vt';

// Arena scenes for the trailer: the real run screen (PixiJS arena + React HUD), staged through the simulation and
// recorded at 60 fps. SCENE picks one (env VITE_SCENE), FRAMES caps the length for quick tries.

const SCENE = import.meta.env['VITE_SCENE'] ?? 'horde';
const FRAMES = Number(import.meta.env['VITE_FRAMES'] ?? 0);
// Stills (VITE_STILL=1): the enemies' white hit flash is left out of the picture. In motion it is a blink; frozen in a
// screenshot, dozens of white silhouettes. The simulation still sees it (it gates knockback); only the drawing does not.
const STILL = import.meta.env['VITE_STILL'] === '1';

function noFlashInPicture(sim: Sim): void {
  const hide = (real: Int32Array, drawer: RegExp) =>
    new Proxy(real, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        if (typeof v === 'number' && v > 0 && drawer.test(new Error().stack ?? '')) return 0;
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set: (t, k, v) => Reflect.set(t, k, v, t),
    });
  sim.enemies.flashT = hide(sim.enemies.flashT as Int32Array, /drawEnemies/);
  sim.props.flashT = hide(sim.props.flashT as Int32Array, /drawProps/);
  // The admin's test-run «god» switch: no damage, so no red hurt edge on the screen (it shows nothing else).
  sim.debug = { god: true };
}

const run = (over: Partial<RunStart> = {}): RunStart => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  seed: '20261112',
  sector: 'signal-rift',
  probe: 'spark',
  relics: [],
  bonuses: [],
  variant: null,
  anomaly: null,
  content: DEFAULT_CONTENT,
  contentVersion: 0,
  startedAt: '2026-11-12T19:00:00.000Z',
  ...over,
});

function fastForward(sim: Sim, ticks: number): void {
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    const p = sim.probes[0]!;
    // The bot plays the run up to the shot, and never falls on the way (its levels recompute the stats).
    p.hp = p.stats.maxHp;
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
    else step(sim, [botInput(sim, 0, 99)]);
  }
}

/** Late-run power: six evolved weapons, a probe that will not fall during the shot. */
function empower(sim: Sim): void {
  const p = sim.probes[0]!;
  p.weapons = ['pulse-storm', 'solar-breath', 'asteroid-belt', 'ion-storm', 'missile-swarm', 'event-horizon'].map((id) => ({ id, level: 1, t: 0 }));
  p.level = Math.max(p.level, 38);
  // Stills show the probe's real life on the bar (keepAlive tops it up instead).
  if (STILL) return;
  p.stats.maxHp = 9999;
  p.hp = 9999;
}

/** A ring of fauna round the probe, `count` strong, between `near` and `far` world units away. */
function swarm(sim: Sim, count: number, near: number, far: number): void {
  const p = sim.probes[0]!;
  const fauna = sim.content.enemies.filter((e) => !sim.content.bosses.some((b) => b.id === e.id));
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + k * 0.37;
    const r = near + ((k * 7919) % 1000) / 1000 * (far - near);
    spawnEnemy(sim, fauna[k % fauna.length]!, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
  }
}

async function mount(vt: VirtualTime, start: RunStart, setup: (sim: Sim) => void): Promise<Sim> {
  // Stills come some mouse-wheel steps closer (VITE_ZOOM, the zoom a player keeps for their runs), so sprites read.
  setArenaZoom(Number(import.meta.env['VITE_ZOOM'] ?? 0));
  document.body.style.margin = '0';
  const css = document.createElement('style');
  // The trailer shows the run, not PERKINS' radio lines.
  css.textContent = '.hud-radio { display: none !important; }';
  document.head.appendChild(css);
  const host = document.createElement('div');
  document.body.appendChild(host);
  let sim: Sim | null = null;
  createRoot(host).render(
    createElement(ArenaScreen, {
      run: start,
      onEnd: () => {},
      onSim: (s: Sim) => {
        if (sim) return;
        sim = s;
        setup(s);
        if (STILL) noFlashInPicture(s);
      },
    }),
  );
  // Let the renderer start (it waits on real promises and on virtual frames).
  for (let i = 0; i < 400 && !document.querySelector('.hud-hp'); i++) {
    await vt.advance(1000 / 60);
    await vt.sleep(5);
  }
  for (let i = 0; i < 30; i++) {
    await vt.advance(1000 / 60);
    await vt.settle();
  }
  return sim!;
}

/** Like `swarm`, with only the run's own sector fauna: what that sector really sends. */
function ownSwarm(sim: Sim, count: number, near: number, far: number): void {
  const p = sim.probes[0]!;
  const ids = [...new Set(sim.sector.spawns.map((sp) => sp.enemy))];
  const fauna = ids.map((id) => sim.content.enemies.find((e) => e.id === id)!);
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + k * 0.37;
    const r = near + (((k * 7919) % 1000) / 1000) * (far - near);
    spawnEnemy(sim, fauna[k % fauna.length]!, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
  }
}

const EIGHT = [['KeyD'], ['KeyD', 'KeyS'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyA', 'KeyW'], ['KeyW'], ['KeyW', 'KeyD']];

/** The boss alive now, or -1. */
function bossIndex(sim: Sim): number {
  const en = sim.enemies;
  for (let i = 0; i < en.top; i++) if (en.alive[i] && en.boss[i]) return i;
  return -1;
}

/** Keys that take the probe towards (x, y), or none when it is already within `near`. */
function towards(sim: Sim, x: number, y: number, near: number): string[] {
  const p = sim.probes[0]!;
  const dx = x - p.x;
  const dy = y - p.y;
  if (Math.hypot(dx, dy) < near) return [];
  const keys: string[] = [];
  if (Math.abs(dx) > near * 0.4) keys.push(dx > 0 ? 'KeyD' : 'KeyA');
  if (Math.abs(dy) > near * 0.4) keys.push(dy > 0 ? 'KeyS' : 'KeyW');
  return keys;
}

const keepAlive = (sim: Sim) => {
  for (const p of sim.probes) {
    // In stills the bar reads like a run going well (a little life lost), never 9999.
    p.hp = STILL ? Math.round(p.stats.maxHp * 0.84) : p.stats.maxHp;
    p.xpNext = 1e12;
  }
};

test(`escena ${SCENE}`, async () => {
  const vt = installVirtualTime();
  const held = new Set<string>();
  if (SCENE === 'horde') {
    const sim = await mount(vt, run(), (s) => {
      // A deep run: the bot plays ten minutes with late-run power, then the horde closes in.
      empower(s);
      fastForward(s, 10 * 3600 + 25 * 60);
      empower(s);
      s.probes[0]!.xpNext = 1e12;
      swarm(s, 260, 160, 460);
    });
    await record(vt, 'horde', FRAMES || 720, (f) => {
      if (f % 70 === 0) hold(EIGHT[(f / 70) % 8]!, held);
      if (f % 30 === 0) swarm(sim, 24, 260, 420);
      keepAlive(sim);
    });
  }
  if (SCENE === 'horde-still') {
    // The promo still: ten minutes into the Outer Nebula, a late-run build, and the sector's own fauna closing in
    // from every side on a probe that drifts slowly (the crowd surrounds it instead of trailing behind).
    const sectorSwarm = (sim: Sim, count: number, near: number, far: number) => {
      const p = sim.probes[0]!;
      const ids = [...new Set(sim.content.sectors.find((x) => x.id === 'outer-nebula')!.spawns.map((sp) => sp.enemy))];
      const fauna = ids.map((id) => sim.content.enemies.find((e) => e.id === id)!);
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + k * 0.37;
        const r = near + (((k * 7919) % 1000) / 1000) * (far - near);
        spawnEnemy(sim, fauna[k % fauna.length]!, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
    };
    const build = (sim: Sim) => {
      const p = sim.probes[0]!;
      p.weapons = ['pulse-storm', 'asteroid-belt', 'ion-storm', 'missile-swarm', 'solar-breath', 'crystal-crown'].map((id) => ({ id, level: 1, t: 0 }));
      p.level = Math.max(p.level, 38);
    };
    const sim = await mount(vt, run({ sector: 'outer-nebula', probe: 'spark', seed: '20261120' }), (s) => {
      build(s);
      fastForward(s, 10 * 3600 + 25 * 60);
      build(s);
      s.probes[0]!.xpNext = 1e12;
      sectorSwarm(s, 260, 230, 560);
    });
    await record(vt, 'horde-still', FRAMES || 240, (f) => {
      if (f % 90 === 0) hold(EIGHT[(f / 90) % 8]!, held);
      if (f % 45 === 0) sectorSwarm(sim, 40, 420, 560);
      keepAlive(sim);
    });
  }
  if (SCENE === 'cards') {
    // Mid-run with a maxed Pulse and its passive: the evolution comes up first and is taken.
    const sim = await mount(vt, run({ sector: 'broken-forge', probe: 'lumen' }), (s) => {
      fastForward(s, 4 * 3600);
      const p = s.probes[0]!;
      p.weapons = [{ id: 'pulse', level: 5, t: 0 }, { id: 'orbit', level: 5, t: 0 }, { id: 'lance', level: 4, t: 0 }];
      p.passives = [{ id: 'capacitor', level: 2 }, { id: 'armor', level: 2 }];
      p.stats.maxHp = 9999;
      p.hp = 9999;
      swarm(s, 90, 140, 360);
    });
    await record(vt, 'cards', FRAMES || 300, (f) => {
      if (f === 40) {
        const p = sim.probes[0]!;
        p.xpNext = 1e12;
        p.pendingLevels = 1;
        p.offer = offerFor(sim, p);
        sim.status = 'choosing';
      }
      if (f === 120) press('Digit1', '1');
      if (f === 150) press('Enter');
      if (f > 160 && f % 40 === 0) hold(EIGHT[(f / 40) % 8]!, held);
      keepAlive(sim);
    });
  }
  if (SCENE === 'boss') {
    // Up to the Núcleo's arrival with late-run power, the fight, and its fall.
    const sim = await mount(vt, run({ sector: 'hollow-reef', probe: 'bastion' }), (s) => {
      empower(s);
      while (s.phase !== 'boss' && s.tick < 20 * 3600) fastForward(s, s.tick + 60);
      empower(s);
      keepAlive(s);
    });
    // The Núcleo holds for the shot (much more life), with fauna round it; it falls on cue.
    let toughened = false;
    await record(vt, 'boss', FRAMES || 660, (f) => {
      const b = bossIndex(sim);
      if (b >= 0 && !toughened) {
        toughened = true;
        sim.enemies.maxHp[b] = sim.enemies.maxHp[b]! * 40;
        sim.enemies.hp[b] = sim.enemies.maxHp[b]!;
        if (STILL) ownSwarm(sim, 90, 240, 480);
        else swarm(sim, 160, 200, 440);
      }
      if (b >= 0 && f < 470 && sim.enemies.hp[b]! < sim.enemies.maxHp[b]! * 0.3) sim.enemies.hp[b] = sim.enemies.maxHp[b]! * 0.3;
      if (b >= 0) hold(towards(sim, sim.enemies.x[b]!, sim.enemies.y[b]! + 110, 60), held);
      if (f === 470 && b >= 0) sim.enemies.hp[b] = Math.min(sim.enemies.hp[b]!, sim.enemies.maxHp[b]! * 0.004);
      if (f % 45 === 0 && f < 470) {
        if (STILL) ownSwarm(sim, 12, 380, 480);
        else swarm(sim, 26, 260, 420);
      }
      keepAlive(sim);
    });
    // Then to the beacon, and out.
    await record(vt, 'extract', FRAMES || 660, () => {
      const bc = sim.beacon;
      if (bc) {
        hold(towards(sim, bc.x, bc.y, bc.radius * 0.4), held);
        // Inside the beacon, the extraction fills in about two seconds for the shot.
        const p = sim.probes[0]!;
        if (Math.hypot(p.x - bc.x, p.y - bc.y) < bc.radius && bc.hold < bc.holdNeeded - 75) bc.hold = bc.holdNeeded - 75;
      } else hold([], held);
      keepAlive(sim);
    });
  }
  if (SCENE === 'coop') {
    // Four probes on one horde (the stage alone, as the co-op screen draws it): names over the teammates.
    document.body.style.margin = '0';
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    canvas.style.display = 'block';
    document.body.appendChild(canvas);
    const ids = ['spark', 'bastion', 'prism', 'comet'];
    const sim = createSim({ seed: '20261113', content: DEFAULT_CONTENT, sector: 'frost-rings', probes: ids.map((probe) => ({ probe, relics: [] })), coop: DEFAULT_COOP_RULES });
    const stage = await createStage(canvas, DEFAULT_CONTENT, { reduced: false, vision: 0, probe: 0, seed: '20261113', biome: 'ice', names: ['Tú', 'nova_k', 'rigel', 'vega'] });
    stage.resize(1920, 1080);
    // Flying together: «Tú» sweeps a slow circle and the three others hold a diamond round it.
    const OFFSETS: [number, number][] = [[0, 0], [70, -40], [-70, -40], [0, 75]];
    let heading = 0;
    const towardsPoint = (i: number, x: number, y: number) => {
      const p = sim.probes[i]!;
      const dx = x - p.x;
      const dy = y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) return { mx: 0, my: 0, aim: -1, pick: -1 };
      const k = Math.min(1, d / 40);
      return { mx: Math.round((dx / d) * 127 * k), my: Math.round((dy / d) * 127 * k), aim: -1, pick: -1 };
    };
    const inputs = () => {
      heading += 0.006;
      const lead = sim.probes[0]!;
      const out = [{ mx: Math.round(Math.cos(heading) * 127), my: Math.round(Math.sin(heading) * 127), aim: -1, pick: -1 }];
      for (let i = 1; i < sim.probes.length; i++) out.push(towardsPoint(i, lead.x + OFFSETS[i]![0], lead.y + OFFSETS[i]![1]));
      return out;
    };
    const power = () => {
      sim.probes.forEach((p, i) => {
        p.weapons = [['pulse-storm', 'ion-storm'], ['asteroid-belt', 'solar-breath'], ['crystal-crown', 'ion-ray'], ['missile-swarm', 'event-horizon']][i]!.map((id) => ({ id, level: 1, t: 0 }));
      });
    };
    power();
    while (sim.tick < 6 * 3600) {
      keepAlive(sim);
      step(sim, sim.probes.map((_, i) => botInput(sim, i, 99)));
    }
    // Regroup round «Tú» before rolling.
    sim.probes.forEach((p, i) => {
      p.x = sim.probes[0]!.x + OFFSETS[i]![0];
      p.y = sim.probes[0]!.y + OFFSETS[i]![1];
      p.px = p.x;
      p.py = p.y;
    });
    power();
    swarm(sim, 240, 200, 470);
    await record(vt, 'coop', FRAMES || 660, (f) => {
      keepAlive(sim);
      if (f % 40 === 0) swarm(sim, 30, 260, 440);
      step(sim, inputs());
      // The red hurt flash is for playing, not for the trailer.
      stage.feed(sim.events.filter((e) => e.t !== 'hurt'), sim.tick);
      stage.render(sim, 1);
    });
  }
});
