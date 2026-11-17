import type { PulledGalaxy, ShownGalaxy } from '@galaxy/shared';
import { useId } from 'react';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { HScroll } from '../ui/HScroll';

// «Escaparate de premios» (2026-11-17, the owner): what can come out of the scanner, as real cards — the legendaries
// and mythics found lately, topped up with examples (marked so) when there are few. Each card says its tier and its most
// striking trait. A strip that scrolls inside itself, never the page.

const traitValues = copy.traitValues as Record<string, Record<string, string>>;

/** The trait worth saying under a card: its phenomenon if it has one, else its type. */
export function standoutTrait(g: Pick<PulledGalaxy, 'traits'>): string {
  const phenomenon = g.traits['phenomenon'];
  if (phenomenon && phenomenon !== 'none') return traitValues['phenomenon']?.[phenomenon] ?? phenomenon;
  const type = g.traits['galaxy_type'];
  return type ? (traitValues['galaxy_type']?.[type] ?? type) : '';
}

export function Showcase({ galaxies }: { galaxies: readonly ShownGalaxy[] }) {
  const id = useId();
  const t = copy.scanner.showcase;
  return (
    <section className="showcase" aria-labelledby={id}>
      <h3 id={id}>{t.title}</h3>
      {galaxies.length === 0 ? (
        <p className="showcase-wait" aria-hidden="true">
          ⠋⠙⠹
        </p>
      ) : (
        <HScroll as="ul" className="showcase-row" label={t.title}>
          {galaxies.map((g) => (
            <li key={g.id} className="showcase-item" data-tier={g.tier}>
              <GalaxyCard galaxy={g} size={92} columns={48} />
              <span className="showcase-text">
                <b>{g.name}</b>
                <small>
                  {copy.tiers[g.tier]}
                  {standoutTrait(g) ? `, ${standoutTrait(g).toLowerCase()}` : ''}
                </small>
              </span>
              {g.example ? <span className="showcase-example">{t.example}</span> : null}
            </li>
          ))}
        </HScroll>
      )}
    </section>
  );
}
