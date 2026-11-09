import type { RunSummary, Sim } from './types';

// The run's outcome and a fingerprint of its whole state (GDD §14.7): two runs with the same hash played the same.

const scratch = new DataView(new ArrayBuffer(8));

/** Two 32-bit FNV-1a lanes over the bytes of the state's numbers (64-bit floats, big-endian). */
class Fnv {
  a = 0x811c9dc5;
  b = 0xcbf29ce4;
  byte(v: number): void {
    this.a = Math.imul(this.a ^ v, 0x01000193);
    this.b = Math.imul(this.b ^ v, 0x01000193) ^ (this.b >>> 15);
  }
  num(v: number): void {
    scratch.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.byte(scratch.getUint8(i));
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.num(s.charCodeAt(i));
    this.num(-1);
  }
  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
  }
}

const STATUS = { running: 0, choosing: 1, extracted: 2, dead: 3 } as const;
const PHASE = { waves: 0, boss: 1, beacon: 2 } as const;

export function stateHash(sim: Sim): string {
  const h = new Fnv();
  h.num(sim.tick);
  h.num(STATUS[sim.status]);
  h.num(sim.layer);
  h.num(PHASE[sim.phase]);
  h.num(sim.phaseTick);
  h.num(sim.kills);
  h.num(sim.bossKills);
  for (const r of Object.values(sim.rng)) for (const w of r.state()) h.num(w);
  for (const p of sim.probes) {
    h.num(p.x);
    h.num(p.y);
    h.num(p.hp);
    h.num(p.shield);
    h.num(p.alive ? 1 : 0);
    h.num(p.level);
    h.num(p.xp);
    for (const w of p.weapons) {
      h.str(w.id);
      h.num(w.level);
      h.num(w.t);
    }
    for (const s of p.passives) {
      h.str(s.id);
      h.num(s.level);
    }
  }
  const en = sim.enemies;
  for (let i = 0; i < en.top; i++) {
    if (!en.alive[i]) continue;
    h.num(i);
    h.num(en.type[i]!);
    h.num(en.x[i]!);
    h.num(en.y[i]!);
    h.num(en.hp[i]!);
    h.num(en.mark[i]!);
    h.num(en.markT[i]!);
    h.num(en.reactT[i]!);
    h.num(en.vulnT[i]!);
    h.num(en.freezeT[i]!);
  }
  for (const pool of [sim.shots, sim.foeShots, sim.pickups, sim.areas]) {
    h.num(pool.count);
    for (let i = 0; i < pool.top; i++) {
      if (!pool.alive[i]) continue;
      h.num(pool.x[i]!);
      h.num(pool.y[i]!);
    }
  }
  const pr = sim.props;
  h.num(pr.count);
  for (let i = 0; i < pr.top; i++) {
    if (!pr.alive[i]) continue;
    h.num(i);
    h.num(pr.hp[i]!);
  }
  for (const l of sim.loot) {
    h.num(l.coins);
    h.num(l.dust);
    h.num(l.components);
  }
  for (const b of sim.blasts) {
    h.num(b.x);
    h.num(b.y);
    h.num(b.at);
  }
  if (sim.beacon) {
    h.num(sim.beacon.t);
    h.num(sim.beacon.hold);
  }
  return h.hex();
}

export function runSummary(sim: Sim): RunSummary {
  return {
    ticks: sim.tick,
    outcome: sim.status === 'extracted' ? 'extracted' : sim.status === 'dead' ? 'dead' : 'running',
    depth: sim.layer,
    kills: sim.kills,
    bossKills: sim.bossKills,
    level: sim.probes.reduce((m, p) => Math.max(m, p.level), 1),
    loot: sim.loot.map((l) => ({ coins: l.coins, dust: l.dust, components: l.components })),
    hash: stateHash(sim),
  };
}
