import { type GrantedItem, type PulledGalaxy, TIERS } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { GiftArt } from '../gifts/GiftArt';
import { type GiftCatalog, giftWords } from '../gifts/words';
import { Dialog } from '../ui/Dialog';
import { useReducedMotion } from '../ui/motion';

// What a claim gave (mail v2, P6; the plan's reveal): each gift pops in after the one before, drawn and in words,
// glowing in its colour; one the player already had or that could not be given says so; the galaxies made come out as
// their cards, with the way to the collection. With reduced motion, everything at once and still.

const t = copy.mail.reveal;
type View = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;

/** `onLeave`: going to the collection closes the mailbox too. */
export function GiftReveal({ granted, catalog, onClose, onLeave }: { granted: readonly GrantedItem[]; catalog: View; onClose: () => void; onLeave?: () => void }) {
  const reduced = useReducedMotion();
  const galaxies: PulledGalaxy[] = granted.flatMap((i) =>
    (i.galaxies ?? []).flatMap((g) =>
      g.seed ? [{ id: g.id, seed: g.seed, tier: TIERS[g.tier] ?? 'common', finish: g.finish as PulledGalaxy['finish'], traits: g.traits ?? {}, name: g.name, designation: g.designation ?? '', featured: false }] : [],
    ),
  );
  return (
    <Dialog title={t.title} onClose={onClose} className={`gift-reveal${reduced ? ' still' : ''}`}>
      <ul className="gift-reveal-grid">
        {granted.map((item, i) => (
          <li key={i} className={`gift-reveal-item ${item.outcome}`} style={{ '--i': i } as CSSProperties}>
            <GiftArt gift={item.gift} catalog={catalog} />
            <span className="gift-reveal-words">
              <span>{giftWords(item.gift, catalog)}</span>
              {item.outcome === 'owned' ? <small>{t.owned}</small> : item.outcome === 'skipped' ? <small className="bad">{t.skipped}</small> : null}
            </span>
          </li>
        ))}
      </ul>
      {galaxies.length > 0 ? (
        <div className="gift-reveal-galaxies">
          {galaxies.map((g, i) => (
            <div key={g.id} className="gift-reveal-card" style={{ '--i': granted.length + i } as CSSProperties}>
              <GalaxyCard galaxy={g} size={150} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="gift-reveal-actions">
        {galaxies.length > 0 ? (
          <Link to="/coleccion" className="lip pill" onClick={onLeave ?? onClose}>
            {t.toCollection}
          </Link>
        ) : null}
        <button type="button" className="lip pill pill-solar" data-autofocus onClick={onClose}>
          {t.close}
        </button>
      </div>
    </Dialog>
  );
}
