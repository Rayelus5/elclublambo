import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useMissions } from '../api/missions';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

/**
 * Today's missions: a segment per mission (lit, with a check, when done), the count, and a «Recoger» badge while a
 * reward waits; leads to the missions. Its own class (hub-missions): the list screens use .missions as their frame.
 */
export function TodayMissions({ d = '1.05s', className = '' }: { d?: string; className?: string }) {
  const daily = useMissions().data?.daily.missions;
  const total = daily?.length ?? 3;
  const done = daily?.filter((m) => m.progress >= m.target).length ?? 0;
  const ready = daily?.filter((m) => !m.claimed && m.progress >= m.target).length ?? 0;
  return (
    <Link to="/misiones" className={`lip panel hub-missions enter ${className}`} data-sfx="hover" style={{ '--d': d } as CSSProperties}>
      <span className="hm-head">
        <span className="hm-icon" aria-hidden="true">
          <Icon name="list" />
        </span>
        <b>{copy.hub.missions}</b>
        {ready > 0 ? <span className="hm-ready">{copy.hub.missionsReady(ready)}</span> : daily ? <span className="hm-count">{copy.hub.missionsCount(done, total)}</span> : null}
      </span>
      <span className="hm-bar" role="progressbar" aria-label={copy.hub.missions} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={copy.hub.missionsDone(done, total)}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < done ? 'on' : undefined}>
            {i < done ? <Icon name="check" /> : null}
          </i>
        ))}
      </span>
      <span className="hm-sub">{!daily ? '⠋⠙⠹' : done >= total ? copy.hub.missionsAllDone : copy.hub.missionsDone(done, total)}</span>
    </Link>
  );
}
