import type { CoopRunStart } from '@galaxy/shared';
import type { ProbeLife, Sim } from '@galaxy/sim';
import type { CSSProperties, ReactNode } from 'react';
import { probeDrawing, spriteDataUrl } from '../arena/sprites';
import { teamTint } from '../arena/stage/palette';
import { usePrefs } from '../settings/prefs';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';

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
      // Its skin when it wore one (plan «skins»), or its own drawing.
      sprite: probeDrawing(p.skin, def?.sprite ?? 'probe-lumen'),
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

/** A figure of the scoreboard: quiet when zero; the group's best (most kills or revives) in a starred pill. */
function Figure({ value, award }: { value: number; award: 'kills' | 'revives' | null }) {
  if (!award) return <td className={value === 0 ? 'zero' : undefined}>{fmt(value)}</td>;
  const label = award === 'kills' ? t.mostKills : t.mostRevives;
  return (
    <td>
      <span className={`team-best ${award}`} title={label}>
        <Icon name="starOn" />
        {fmt(value)}
      </span>
      <span className="sr-only">{label}</span>
    </td>
  );
}

/**
 * `onReport`: a «Denunciar» on each teammate (phase 7); `befriend`: «Añadir amigo» next to them (Nov plan A3). Neither
 * on the viewer's own row, nor when not given (the staff viewer).
 */
export function TeamResults({ rows, me, onReport, befriend }: { rows: TeamRow[]; me: number; onReport?: (username: string) => void; befriend?: (username: string) => ReactNode }) {
  const cvd = usePrefs((p) => p.colorVision);
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
            <tr key={r.slot} className={r.slot === me ? 'is-me' : undefined} style={{ '--tint': hex(teamTint(r.slot, cvd)) } as CSSProperties}>
              <th scope="row">
                <span className="team-who">
                  <img src={spriteDataUrl(r.sprite, 2)} alt="" />
                  <span>
                    <b>{r.slot === me ? copy.coop.arena.you : r.name}</b>
                    <small>{r.probe}</small>
                  </span>
                </span>
                {befriend && r.slot !== me ? befriend(r.name) : null}
                {onReport && r.slot !== me ? (
                  <button type="button" className="team-report" aria-label={copy.coop.report.openOf(r.name)} onClick={() => onReport(r.name)}>
                    {copy.coop.report.open}
                  </button>
                ) : null}
              </th>
              <td>{fmt(r.level)}</td>
              <Figure value={r.kills} award={r.slot === kills ? 'kills' : null} />
              <Figure value={r.revives} award={r.slot === revives ? 'revives' : null} />
              <Figure value={r.downs} award={null} />
              <td>
                <span className={`team-life ${r.life}`}>{copy.coop.arena.life[r.life]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
