import type { RunResult } from '@galaxy/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { clockText } from '../arena/hud/Hud';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';

// The results of a run (GDD §5.1, §11.3 bis): how it ended, what each layer paid at its depth, the half without
// extraction and the daily tiers — nothing is cut without saying so — and what reached the wallet.

/** A number that counts up once (instant with reduced motion). */
function useCountUp(target: number, ms = 900): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') {
      const id = setTimeout(() => setShown(target), 0);
      return () => clearTimeout(id);
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setShown(Math.round(target * (1 - (1 - k) * (1 - k))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return shown;
}

const PAID_ICON = { coins: 'coin', dust: 'dust', signal: 'ticket', material: 'cube' } as const;

function Paid({ kind, value }: { kind: 'coins' | 'dust' | 'signal' | 'material'; value: number }) {
  const shown = useCountUp(value);
  const label =
    kind === 'coins' ? copy.hub.resource.coins(value) : kind === 'dust' ? copy.hub.resource.dust(value) : kind === 'material' ? copy.results.material(value) : copy.results.signals(value);
  return (
    <span className={`result-paid ${kind}`} role="img" aria-label={label}>
      <Icon name={PAID_ICON[kind]} />
      <b aria-hidden="true">{fmt(shown)}</b>
    </span>
  );
}

export function ResultsScreen({ result, onAgain }: { result: RunResult; onAgain: () => void }) {
  const r = result;
  const title = r.outcome === 'extracted' ? copy.results.extracted : r.outcome === 'died' ? copy.results.died : copy.results.abandoned;
  return (
    <div className={`results ${r.outcome}`}>
      <h1>{title}</h1>
      <dl className="results-stats">
        <div>
          <dt>{copy.results.depth}</dt>
          <dd>{copy.arena.layer(r.depth)}</dd>
        </div>
        <div>
          <dt>{copy.results.time}</dt>
          <dd>{clockText(r.ticks / 60)}</dd>
        </div>
        <div>
          <dt>{copy.results.kills}</dt>
          <dd>{fmt(r.kills)}</dd>
        </div>
        <div>
          <dt>{copy.results.level}</dt>
          <dd>{copy.arena.levelShort(r.level)}</dd>
        </div>
      </dl>
      {/* A result kept from before M5a (a pending run resent across the deploy) has no progress. */}
      {r.progress ? (
      <section className="lip panel results-progress" aria-label={copy.social.progressTitle}>
        <span className="results-xp">{copy.social.xp(r.progress.xp)}</span>
        <span className={`results-level${r.progress.levelUp ? ' up' : ''}`}>
          {copy.social.level(r.progress.level)}
          {r.progress.levelUp ? <b>{copy.social.levelUp}</b> : null}
        </span>
        {r.progress.points > 0 ? <span className="results-points">{copy.social.points(r.progress.points)}</span> : null}
        {r.progress.shards ? (
          <span className="results-points">
            <Icon name="shard" />
            {copy.social.shards(r.progress.shards)}
          </span>
        ) : null}
      </section>
      ) : null}
      <section className="lip panel results-loot" aria-label={copy.results.loot}>
        <h2>{copy.results.loot}</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">{copy.results.layer}</th>
              <th scope="col">{copy.results.coins}</th>
              <th scope="col">{copy.results.dust}</th>
              <th scope="col">{copy.results.multiplier}</th>
            </tr>
          </thead>
          <tbody>
            {r.breakdown.layers.map((l) => (
              <tr key={l.layer}>
                <th scope="row">{copy.arena.layer(l.layer)}</th>
                <td>{fmt(l.coins)}</td>
                <td>{fmt(l.dust)}</td>
                <td>×{fmt(l.multiplier)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.breakdown.share < 1 && <p className="results-note static">{copy.results.half}</p>}
        {(r.breakdown.boosts ?? []).length > 0 && (
          <div className="results-daily results-boosts">
            <h3>{copy.boosts.resultsTitle}</h3>
            <ul>
              {(r.breakdown.boosts ?? []).map((b) => (
                <li key={b.id}>{copy.boosts.paid(b.name, copy.boosts.currencies[b.currency] ?? b.currency, b.factor)}</li>
              ))}
            </ul>
          </div>
        )}
        {r.breakdown.daily.length > 0 && (
          <div className="results-daily">
            <h3>{copy.results.dailyTitle}</h3>
            <ul>
              {r.breakdown.daily.map((d, i) => (
                <li key={i} className={d.multiplier < 1 ? 'cut' : ''}>
                  {copy.results.daily(Math.round((d.seconds / 60) * 10) / 10, d.multiplier)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="results-paid">
          <h3>{copy.results.paid}</h3>
          <Paid kind="coins" value={r.payout.coins} />
          <Paid kind="dust" value={r.payout.dust} />
          {r.payout.signals > 0 && <Paid kind="signal" value={r.payout.signals} />}
          {r.payout.material > 0 && <Paid kind="material" value={r.payout.material} />}
        </div>
      </section>
      <div className="results-actions">
        <Link to="/" className="lip pill">
          <Icon name="back" />
          <span>{copy.results.home}</span>
        </Link>
        <button type="button" className="lip pill pill-solar" onClick={onAgain} autoFocus>
          <Icon name="play" />
          <span>{copy.results.again}</span>
        </button>
      </div>
    </div>
  );
}
