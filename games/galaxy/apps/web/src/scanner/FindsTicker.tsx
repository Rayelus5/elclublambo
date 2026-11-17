import type { FindView, PulledGalaxy } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { useEffect, useId, useState } from 'react';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// «Últimos hallazgos» (2026-11-17, the owner): a band under the scanner with the legendaries and mythics found lately by
// anyone («rayelus encontró una Legendaria, hace 2 min»), crawling slowly from right to left, and my best scans of the
// week at its end. The list is a real list for screen readers (the crawl's second copy is hidden from them, and nothing
// is announced as it moves); it stops under the pointer or the keyboard; with reduced motion it stands still.

const ago = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' });

/** «hace 2 min», «hace 3 h», «ayer»… from an ISO time. */
export function agoText(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return ago.format(-Math.max(1, s), 'second');
  if (s < 3600) return ago.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return ago.format(-Math.round(s / 3600), 'hour');
  return ago.format(-Math.round(s / 86_400), 'day');
}

function Find({ f, now }: { f: FindView; now: number }) {
  return (
    <li data-tier={f.galaxy.tier}>
      <i aria-hidden="true" />
      <span>
        {copy.scanner.finds.found(f.by, copy.tiers[f.galaxy.tier])} <b>{f.galaxy.name}</b>
      </span>
      <time dateTime={f.at}>{agoText(f.at, now)}</time>
    </li>
  );
}

/** The time now, again every minute («hace 2 min» keeps true while the screen stays open). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function FindsTicker({ recent, mine, now: fixed }: { recent: readonly FindView[]; mine: readonly PulledGalaxy[]; now?: number }) {
  const clock = useMinuteClock();
  const now = fixed ?? clock;
  const id = useId();
  const t = copy.scanner.finds;
  const items = recent.slice(0, 16);
  // About 5 s per find on screen: a slow crawl whatever how many there are.
  const style = { '--crawl': `${Math.max(20, items.length * 5)}s` } as CSSProperties;
  return (
    <section className="finds" aria-labelledby={id}>
      <h3 id={id} className="finds-title">
        <Icon name="starOn" outline />
        <span>{t.title}</span>
      </h3>
      <div className="finds-view">
        {items.length === 0 ? (
          <p className="finds-none">{t.none}</p>
        ) : (
          <div className="finds-track" style={style}>
            <ul className="finds-list">
              {items.map((f) => (
                <Find key={f.id} f={f} now={now} />
              ))}
            </ul>
            <ul className="finds-list finds-copy" aria-hidden="true">
              {items.map((f) => (
                <Find key={f.id} f={f} now={now} />
              ))}
            </ul>
          </div>
        )}
      </div>
      {mine.length > 0 ? (
        <div className="finds-mine">
          <span>{t.mine}</span>
          <ul aria-label={t.mine}>
            {mine.map((g) => (
              <li key={g.id} data-tier={g.tier}>
                <i aria-hidden="true" />
                <b>{g.name}</b>
                <span className="sr-only">{copy.tiers[g.tier]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
