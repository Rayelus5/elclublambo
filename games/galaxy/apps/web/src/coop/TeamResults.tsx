import type { CoopRunStart } from '@galaxy/shared';
import type { ProbeLife, Sim } from '@galaxy/sim';
import type { CSSProperties } from 'react';
import { spriteDataUrl } from '../arena/sprites';
import { TEAM_TINT } from '../arena/stage/stage';
import { copy, fmt } from '../copy/es';

// The group run's results by player (multiplayer plan, phase 6c): what each one did, read from the simulation every
// client runs alike (so it needs nothing from the server): probe, level reached, kills, revives, falls and how they
// ended. The most kills and the most revives are named (a revive only counts when someone revived).

const t = copy.coop.results;

export interface TeamRow {
  slot: number;
  name: string;
  probe: string;
  sprite: string;
  level: number;
  kills: number;
  revives: number;
  downs: number;
  life: ProbeLife;
}

export function teamRows(sim: Sim, start: Pick<CoopRunStart, 'players' | 'content'>): TeamRow[] {
  return start.players.map((p, slot) => {
    const probe = sim.probes[slot];
    const def = start.content.probes.find((x) => x.id === p.probe);
    return {
      slot,
      name: p.username,
      probe: def?.name ?? p.probe,
      sprite: def?.sprite ?? 'probe-lumen',
      level: probe?.level ?? 1,
      kills: probe?.kills ?? 0,
      revives: probe?.revives ?? 0,
      downs: probe?.downs ?? 0,
      life: probe?.life ?? 'up',
    };
  });
}

/** The one slot with strictly the most of `key` (none when nobody has any, or it is a tie). */
function best(rows: TeamRow[], key: 'kills' | 'revives'): number | null {
  const top = Math.max(...rows.map((r) => r[key]));
  const at = rows.filter((r) => r[key] === top);
  return top > 0 && at.length === 1 ? at[0]!.slot : null;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function TeamResults({ rows, me }: { rows: TeamRow[]; me: number }) {
  const kills = best(rows, 'kills');
  const revives = best(rows, 'revives');
  return (
    <section className="lip panel team-results" aria-labelledby="team-results">
      <h2 id="team-results">{t.title}</h2>
      <table aria-labelledby="team-results">
        <thead>
          <tr>
            <th scope="col">{t.player}</th>
            <th scope="col">{t.level}</th>
            <th scope="col">{t.kills}</th>
            <th scope="col">{t.revives}</th>
            <th scope="col">{t.downs}</th>
            <th scope="col">{t.end}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slot} className={r.slot === me ? 'me' : undefined} style={{ '--tint': hex(TEAM_TINT[r.slot % TEAM_TINT.length]!) } as CSSProperties}>
              <th scope="row">
                <span className="team-who">
                  <img src={spriteDataUrl(r.sprite, 2)} alt="" />
                  <span>
                    <b>{r.slot === me ? copy.coop.arena.you : r.name}</b>
                    <small>{r.probe}</small>
                  </span>
                </span>
                {r.slot === kills || r.slot === revives ? (
                  <span className="team-awards">
                    {r.slot === kills ? <span className="team-award kills">{t.mostKills}</span> : null}
                    {r.slot === revives ? <span className="team-award revives">{t.mostRevives}</span> : null}
                  </span>
                ) : null}
              </th>
              <td>{fmt(r.level)}</td>
              <td>{fmt(r.kills)}</td>
              <td>{fmt(r.revives)}</td>
              <td>{fmt(r.downs)}</td>
              <td>{copy.coop.arena.life[r.life]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
