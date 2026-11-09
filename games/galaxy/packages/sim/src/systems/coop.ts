import { PICK_SEQ, PRESENCE } from '../log';
import { IDLE, type ProbeInput, type ProbeState, type Sim } from '../types';
import { ticks } from '../version';
import { PROBE_RADIUS } from './probes';
import { refreshStats } from './stats';
import { applyOffer, offerFor } from './upgrades';

// The co-op rules inside the run (multiplayer plan, phase 4). Nothing here runs in solo (sim.coop is null), so a solo
// run plays exactly as before. The world never pauses: an open offer has a deadline and is answered by a pick that
// names it (its sequence number), or taken for the player when time is up. A probe at 0 life falls; a teammate
// standing by it brings it back, and one left alone too long is out until the next layer. Presence comes in the
// inputs (sticky): away probes are intangible and ignored, left ones are gone for good. The players still in the run
// scale the enemies, chosen again at the start of each layer.

const LIFE_OF_PRESENCE = ['up', 'away', 'left'] as const;

/** Players the run counts: everyone but those who left. */
export function playersIn(sim: Sim): number {
  return Math.max(1, sim.probes.filter((p) => p.life !== 'left').length);
}

/** A co-op multiplier for the players the layer is scaled for (1 in solo). */
export function coopFactor(sim: Sim, key: 'enemyHp' | 'enemyDamage' | 'density' | 'bossHp'): number {
  const c = sim.coop;
  if (!c) return 1;
  const table = c[key];
  return table[Math.min(table.length, Math.max(1, sim.players)) - 1] ?? 1;
}

function stand(sim: Sim, p: ProbeState, hpFraction: number): void {
  p.alive = true;
  p.life = 'up';
  p.downT = 0;
  p.reviveT = 0;
  p.hp = Math.max(1, p.stats.maxHp * hpFraction);
  p.invulnT = ticks(sim.coop!.reviveInvuln);
}

/** At the start of a co-op tick: presence changes, then the picks that name the offer still open. */
export function applyCoopInputs(sim: Sim, inputs: readonly ProbeInput[]): void {
  for (const p of sim.probes) {
    const input = inputs[p.index] ?? IDLE;
    const presence = LIFE_OF_PRESENCE[Math.trunc(input.presence ?? 0)] ?? 'up';
    // What the probe's state says about its presence now (down and out count as here).
    if (p.life !== 'left' && presence !== (p.life === 'away' ? 'away' : 'up')) {
      if (presence === 'left') {
        p.life = 'left';
        p.alive = false;
        sim.events.push({ t: 'presence', probe: p.index, life: 'left' });
        if (sim.log) sim.log.events.push(sim.tick, p.index, PRESENCE, 2, 0, 0);
      } else if (presence === 'away' && p.life === 'up') {
        p.life = 'away';
        p.alive = false;
        sim.events.push({ t: 'presence', probe: p.index, life: 'away' });
        if (sim.log) sim.log.events.push(sim.tick, p.index, PRESENCE, 1, 0, 0);
      } else if (presence === 'up' && p.life === 'away') {
        stand(sim, p, Math.max(0.01, p.hp / Math.max(1, p.stats.maxHp)));
        sim.events.push({ t: 'presence', probe: p.index, life: 'up' });
        if (sim.log) sim.log.events.push(sim.tick, p.index, PRESENCE, 0, 0, 0);
      }
    }
    if (!p.offer || p.life === 'left') continue;
    const pick = input.pick;
    if (!Number.isInteger(pick) || pick < 0 || pick >= p.offer.length) continue;
    if (input.offer !== (p.offerSeq & 255)) continue;
    if (sim.log) sim.log.events.push(sim.tick, p.index, PICK_SEQ, pick, p.offerSeq & 255, 0);
    take(sim, p, pick);
  }
  if (sim.status === 'running' && !sim.probes.some((p) => p.life === 'up' || p.life === 'down')) sim.status = 'dead';
}

function take(sim: Sim, p: ProbeState, index: number): void {
  applyOffer(sim, p, p.offer![index]!);
  p.pendingLevels--;
  p.offer = null;
  open(sim, p);
}

/** Opens a probe's next offer when it has levels pending (with a new sequence number and deadline). */
function open(sim: Sim, p: ProbeState): void {
  if (p.pendingLevels <= 0 || p.offer || p.life === 'left') return;
  p.offer = offerFor(sim, p);
  p.offerSeq++;
  p.offerUntil = sim.tick + ticks(sim.coop!.pickSeconds);
}

/** The co-op end of a tick: offers for new levels and, past their deadline, the card taken for the player. */
export function updateOffers(sim: Sim): void {
  for (const p of sim.probes) {
    if (p.offer && sim.tick >= p.offerUntil) {
      const index = sim.rng.offer.int(p.offer.length);
      sim.events.push({ t: 'offerAuto', probe: p.index, index });
      take(sim, p, index);
    }
    open(sim, p);
  }
}

/** A probe's life ran out in co-op: it falls and waits for a teammate. */
export function downProbe(sim: Sim, p: ProbeState): void {
  p.hp = 0;
  p.alive = false;
  p.life = 'down';
  p.downT = ticks(sim.coop!.downSeconds);
  p.reviveT = 0;
  p.downs++;
  sim.events.push({ t: 'probeDown', probe: p.index });
  if (!sim.probes.some((q) => q.life === 'up')) sim.status = 'dead';
}

/**
 * Fallen probes: a standing teammate within reach fills the revive (and holds the countdown); alone, the revive
 * drains and the countdown runs. Filled: back on its feet. Run out: out until the next layer.
 */
export function updateDowned(sim: Sim): void {
  const c = sim.coop;
  if (!c) return;
  const need = ticks(c.reviveSeconds);
  const reach = c.reviveRadius + PROBE_RADIUS;
  for (const p of sim.probes) {
    if (p.life !== 'down') continue;
    let by = -1;
    for (const q of sim.probes) {
      if (q.life !== 'up') continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      if (dx * dx + dy * dy <= reach * reach) {
        by = q.index;
        break;
      }
    }
    if (by >= 0) {
      p.reviveT++;
      if (p.reviveT >= need) {
        stand(sim, p, c.reviveHp);
        sim.probes[by]!.revives++;
        sim.events.push({ t: 'probeRevived', probe: p.index, by });
      }
      continue;
    }
    if (p.reviveT > 0) p.reviveT--;
    p.downT--;
    if (p.downT <= 0) {
      p.life = 'out';
      p.downT = 0;
      p.reviveT = 0;
      sim.events.push({ t: 'probeOut', probe: p.index });
    }
  }
}

/** A new layer: the probes that were out come back next to the group, and the layer is scaled for who is still in. */
export function reenter(sim: Sim): void {
  const c = sim.coop;
  if (!c) return;
  sim.players = playersIn(sim);
  const up = sim.probes.filter((p) => p.life === 'up');
  if (up.length === 0) return;
  let cx = 0;
  let cy = 0;
  for (const p of up) {
    cx += p.x;
    cy += p.y;
  }
  cx /= up.length;
  cy /= up.length;
  for (const p of sim.probes) {
    if (p.life !== 'out') continue;
    p.x = p.px = cx + (p.index - (sim.probes.length - 1) / 2) * 24;
    p.y = p.py = cy + 24;
    refreshStats(sim, p);
    stand(sim, p, c.reviveHp);
    sim.events.push({ t: 'probeBack', probe: p.index });
  }
}
