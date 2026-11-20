import type { ProbeState, Sim } from '../types';
import { ticks } from '../version';
import { PROBE_RADIUS, staticHurt } from './probes';

// «La Estática te alcanza» (2026-11-16): standing still is how a strong build farmed the first sector for half an hour.
// A probe that stays within `radius` of where it stopped is warned after `warn` seconds; from `hurt` seconds the Static
// hurts it more and more (damage + growth a second, up to max, × its maximum life a second) and blocks its healing
// (healing.ts), until it leaves the area (a dash does). It does not count while it holds the beacon, while it loots an
// abandoned ship or while it revives a fallen teammate. In a group it counts while the probe picks a card: it can move
// then (review of 2026-11-16: levelling up nonstop kept a card open, and the Static off, for good). Only probes standing
// up count.

function frozen(sim: Sim, p: ProbeState): boolean {
  const b = sim.beacon;
  if (b) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const r = b.radius + PROBE_RADIUS;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  // Looting an abandoned ship (run-events.ts) is standing still on purpose.
  const wreck = sim.content.events.wreck.radius + PROBE_RADIUS;
  for (const ev of sim.world.active) {
    if (ev.kind !== 'wreck') continue;
    const dx = p.x - ev.x;
    const dy = p.y - ev.y;
    if (dx * dx + dy * dy <= wreck * wreck) return true;
  }
  if (sim.coop) {
    // Not while it picks a card: it can move then, and someone levelling up nonstop kept a card open for good.
    const reach = sim.coop.reviveRadius + PROBE_RADIUS;
    for (const q of sim.probes) {
      if (q === p || q.life !== 'down') continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy <= reach * reach) return true;
    }
  }
  return false;
}

export function updateStillness(sim: Sim): void {
  const s = sim.content.stillness;
  if (s.hurt <= 0) return;
  const warn = ticks(s.warn);
  const hurt = ticks(s.hurt);
  for (const p of sim.probes) {
    const st = p.still;
    if (!p.alive || p.life !== 'up') {
      st.x = p.x;
      st.y = p.y;
      st.t = 0;
      continue;
    }
    const dx = p.x - st.x;
    const dy = p.y - st.y;
    if (dx * dx + dy * dy > s.radius * s.radius) {
      if (warn > 0 ? st.t >= warn : st.t >= hurt) sim.events.push({ t: 'static', probe: p.index, what: 'stop' });
      st.x = p.x;
      st.y = p.y;
      st.t = 0;
      continue;
    }
    if (frozen(sim, p)) continue;
    st.t++;
    if (warn > 0 && warn < hurt && st.t === warn) sim.events.push({ t: 'static', probe: p.index, what: 'warn' });
    if (st.t === hurt) sim.events.push({ t: 'static', probe: p.index, what: 'start' });
    if (st.t < hurt) continue;
    const since = st.t - hurt;
    const rate = Math.min(s.max, s.damage + (s.growth * since) / 60);
    staticHurt(sim, p, (p.stats.maxHp * rate) / 60);
    if (since % 30 === 0) sim.events.push({ t: 'staticTick', probe: p.index });
  }
}
