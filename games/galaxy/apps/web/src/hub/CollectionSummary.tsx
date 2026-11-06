import { TIERS, type CollectionPage } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';

// The right panel of the title screen: how many galaxies of each tier the player owns and their rarest ones. It
// takes the place the season ranking will have when seasons exist (DESIGN_SYSTEM §7). `data-tier` sets `--tc`.

export function CollectionSummary({ page }: { page: CollectionPage | undefined }) {
  const total = page ? TIERS.reduce((n, t) => n + page.counts[t], 0) : undefined;
  return (
    <aside className="lip panel collection-summary enter" style={{ '--d': '1.1s' } as CSSProperties} aria-labelledby="summary-title">
      <div className="hd">
        <Icon name="cards" />
        <div>
          <h2 id="summary-title">{copy.hub.summaryTitle}</h2>
          <span>{total === undefined ? copy.loading : copy.hub.galaxies(total)}</span>
        </div>
      </div>
      {page ? (
        <>
          <ul className="tier-counts" aria-label={copy.hub.byTier}>
            {[...TIERS].reverse().map((t) => (
              <li key={t} data-tier={t} className={page.counts[t] ? undefined : 'none'}>
                <i aria-hidden="true" />
                <b>{fmt(page.counts[t])}</b>
                <span>{copy.tiers[t]}</span>
              </li>
            ))}
          </ul>
          {page.items.length > 0 ? (
            <>
              <h3>{copy.hub.summaryBest}</h3>
              <ol className="best">
                {page.items.map((g) => (
                  <li key={g.id} data-tier={g.tier}>
                    <i aria-hidden="true" />
                    <span className="n">
                      <b>{g.name}</b>
                      <span>{g.designation}</span>
                    </span>
                    <span className="tag">{copy.tiers[g.tier]}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="empty">{copy.hub.summaryEmpty}</p>
          )}
          <Link to={page.items.length > 0 ? '/coleccion' : '/escaner'} className="lip more">
            {page.items.length > 0 ? copy.hub.openCollection : copy.hub.scanNow}
          </Link>
        </>
      ) : (
        <p className="empty" role="status">
          {copy.loading}
        </p>
      )}
    </aside>
  );
}
