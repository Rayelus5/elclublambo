import { debugInfo, SIM_VERSION, type Sim } from '@galaxy/sim';
import { useEffect, useState } from 'react';
import { copy } from '../../copy/es';
import { clockText } from '../hud/Hud';
import type { Rates } from './rates';

// The admin debug mode's read-out (2026-11-15), four times a second: the director's own numbers (how much life the
// enemies have now and why), the probe, the run's damage per second and how fast it really goes.

const t = copy.arena.debug;
const READ_MS = 250;

const x = (n: number) => `×${n.toFixed(2).replace('.', ',')}`;
const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');

export function DebugInfo({ sim, rates, now, speed, content }: { sim: Sim; rates: Rates; now: () => number; speed: number; content: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((k) => k + 1), READ_MS);
    return () => clearInterval(id);
  }, []);
  const d = debugInfo(sim, 0);
  const r = rates.read(now(), sim.tick);
  const rows: [string, string][] = [
    [t.rows.fps, String(r.fps)],
    [t.rows.speed, `${x(r.speed)} (${t.speedValue(speed)})`],
    [t.rows.time, clockText(d.tick / 60)],
    [t.rows.sector, sim.sector.name],
    [t.rows.layer, String(d.layer)],
    [t.rows.phase, t.phases[d.phase] ?? d.phase],
    [t.rows.toCore, clockText(d.toCore)],
    [t.rows.enemies, `${d.fauna} / ${d.cap}${d.boss ? ' + 1' : ''}`],
    [t.rows.rate, d.rate.toFixed(2).replace('.', ',')],
    [t.rows.teamLevel, String(d.teamLevel)],
    [t.rows.levelFactor, x(d.levelFactor)],
    [t.rows.truce, t.truce[d.truce]],
    [t.rows.enemyHp, x(d.scale.hp)],
    [t.rows.enemyDamage, x(d.scale.damage)],
    [t.rows.elite, `${Math.round(d.scale.elite * 100)} %`],
    [t.rows.core, d.boss ? `${n0(d.boss.hp)} / ${n0(d.boss.maxHp)}` : '—'],
    [t.rows.coreFactor, x(d.coreFactor)],
    [t.rows.dps, n0(r.dps)],
    [t.rows.hp, `${n0(d.hp)} / ${n0(d.maxHp)}`],
    [t.rows.shield, n0(d.shield)],
    [t.rows.armor, `${Math.round(d.stats.armor * 100)} %`],
    [t.rows.damage, d.stats.damage.toFixed(2).replace('.', ',')],
    [t.rows.pools, `${d.pools.shots} · ${d.pools.foeShots} · ${d.pools.pickups} · ${d.pools.areas}`],
    [t.rows.content, content],
    [t.rows.sim, SIM_VERSION],
  ];
  return (
    <section className="debug-info" aria-label={t.infoTitle}>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
