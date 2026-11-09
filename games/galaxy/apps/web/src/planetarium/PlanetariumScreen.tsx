import type { PlanetariumCard } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { usePlanetarium, useSetExhibits } from '../api/planetarium';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { GalaxyPicker } from '../cards/GalaxyPicker';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Dome, PrestigePanel, ShownCard, VisitForm } from './Dome';
import { BackLink } from '../ui/BackLink';

// The player's planetarium (GDD §10.5, §8.5; DESIGN_SYSTEM §8 decies): six pedestals under the dome; an empty one
// offers to exhibit a galaxy and a full one holds its card (pick it to change it) with «Retirar». Beside it, the
// prestige with its experience bonus and the visits, and a field to visit someone's planetarium by name; below, the
// featured planetariums.

const t = copy.planetarium;
const PICKER = { title: t.pickerTitle, empty: t.pickerEmpty, pick: t.pick, taken: t.exhibited };

function Featured({ cards }: { cards: PlanetariumCard[] }) {
  const title = useId();
  return (
    <section className="featured" aria-labelledby={title}>
      <h2 id={title}>{t.featured}</h2>
      {cards.length === 0 ? (
        <p className="featured-empty">{t.featuredEmpty}</p>
      ) : (
        <ul className="featured-list" aria-label={t.featured}>
          {cards.map((c) => (
            <li key={c.owner}>
              <Link to={`/planetario/${encodeURIComponent(c.owner)}`} className="featured-card" aria-label={t.featuredItem(c.owner, c.prestige)}>
                {c.cover ? <GalaxyCard galaxy={c.cover} size={112} /> : null}
                <b>{c.owner}</b>
                <span>{t.featuredPrestige(c.prestige)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlanetariumScreen() {
  const planet = usePlanetarium();
  const set = useSetExhibits();
  const [picking, setPicking] = useState<number | null>(null);
  const v = planet.data;
  const ids = v ? Array.from({ length: v.slots }, (_, i) => v.exhibits[i]?.id ?? null) : [];
  // One row at a time: while it saves, the pedestals send nothing else (a second row would be built from the old one).
  const save = (next: (string | null)[]) => set.mutate(next);
  const busy = set.isPending;
  const error = errorText(set.error ?? planet.error, copy.errors);

  return (
    <div className="screen-root planetarium-root">
      <div className="planetarium">
        <header className="collection-bar">
          <BackLink fallback="/estacion" />
          <h1>{t.title}</h1>
        </header>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {v ? (
          <>
            <div className="planetarium-body">
              <Dome
                empty={ids.every((id) => id === null) ? t.emptyMine : undefined}
                items={ids.map((_, i) => {
                  const g = v.exhibits[i];
                  return g ? (
                    <>
                      <ShownCard galaxy={g}>
                        <button type="button" className="gcard-hit" aria-label={t.change(g.name)} disabled={busy} onClick={() => setPicking(i)} />
                      </ShownCard>
                      <button
                        type="button"
                        className="lip pill pedestal-remove"
                        aria-label={t.removeNamed(g.name)}
                        disabled={busy}
                        onClick={() => save(ids.map((id, k) => (k === i ? null : id)))}
                      >
                        {t.remove}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="pedestal-empty" aria-label={t.exhibitAt(i + 1)} disabled={busy} onClick={() => setPicking(i)}>
                      <Icon name="cards" />
                      <span>{t.exhibit}</span>
                    </button>
                  );
                })}
              />
              <aside className="planetarium-side">
                <PrestigePanel prestige={v.prestige} bonus={v.bonus} cap={v.cap} visits={v.visits} />
                <VisitForm />
              </aside>
            </div>
            <Featured cards={v.featured} />
          </>
        ) : planet.isPending ? (
          <p className="planetarium-wait" role="status" aria-label={copy.loading}>
            ⠋⠙⠹
          </p>
        ) : null}
        {picking !== null && v ? (
          <GalaxyPicker
            text={PICKER}
            className="relic-picker"
            taken={new Set(ids.filter((id): id is string => id !== null && id !== ids[picking]))}
            onClose={() => setPicking(null)}
            onPick={(g) => {
              // Closed on pick, like the Hangar's: a refusal shows on the screen, not behind the dialog.
              const next = ids.map((id) => (id === g.id ? null : id));
              next[picking] = g.id;
              setPicking(null);
              save(next);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
