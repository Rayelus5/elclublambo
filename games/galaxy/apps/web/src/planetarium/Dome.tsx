import type { GalaxySummary, PublicGalaxy } from '@galaxy/shared';
import { type CSSProperties, type FormEvent, type ReactNode, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';
import { DOME, domeUrl } from './art';

// The planetarium's scene (GDD §10.5, DESIGN_SYSTEM §8 decies): the dome painted in Aseprite at an integer scale, its
// projector turning (still with reduced motion), and the six pedestals with a card floating over each. The prestige
// panel says what the display adds up to.

const t = copy.planetarium;

/** The dome with one item per pedestal (its art has six: the rest of `items` is left out). */
export function Dome({ items, empty }: { items: ReactNode[]; empty?: string }) {
  return (
    <div className="dome">
      <div className="dome-art" aria-hidden="true" style={domeUrl ? { backgroundImage: `url(${domeUrl})` } : undefined} />
      {empty ? <p className="dome-empty">{empty}</p> : null}
      <ul className="dome-pedestals" aria-label={t.pedestals}>
        {items.slice(0, DOME.pedestals.length).map((item, i) => (
          <li key={i} className="pedestal" style={{ '--x': DOME.pedestals[i] } as CSSProperties}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A card on its pedestal (the size is the largest the dome draws it; CSS sets the one in sight). */
export function ShownCard({ galaxy, children }: { galaxy: GalaxySummary | PublicGalaxy; children?: ReactNode }) {
  return (
    <GalaxyCard galaxy={galaxy} size={168} interactive>
      {children}
    </GalaxyCard>
  );
}

export function PrestigePanel({ prestige, bonus, visits }: { prestige: number; bonus?: number; visits: number }) {
  const title = useId();
  return (
    <section className="lip panel prestige-panel" aria-labelledby={title}>
      <h2 id={title}>{t.prestige}</h2>
      <p className="prestige-value">{fmt(prestige)}</p>
      {bonus === undefined ? null : (
        <>
          <p className="prestige-bonus">{t.bonus(bonus)}</p>
          <p className="prestige-hint">{t.prestigeHint}</p>
        </>
      )}
      <p className="prestige-visits">
        <Icon name="eye" />
        <span>{t.visits(visits)}</span>
      </p>
    </section>
  );
}

/** Visit someone's planetarium by name (lower case, as usernames are kept). */
export function VisitForm() {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const title = useId();
  const field = useId();
  const clean = name.trim().toLowerCase();
  function go(e: FormEvent): void {
    e.preventDefault();
    if (clean) navigate(`/planetario/${encodeURIComponent(clean)}`);
  }
  return (
    <form role="search" aria-labelledby={title} className="lip panel visit-form" onSubmit={go}>
      <h2 id={title}>{t.visitTitle}</h2>
      <label htmlFor={field}>{t.visitLabel}</label>
      <div className="visit-row">
        <input id={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} maxLength={24} />
        <button type="submit" className="lip pill pill-solar" disabled={!clean}>
          <Icon name="compass" />
          <span>{t.visitGo}</span>
        </button>
      </div>
    </form>
  );
}
