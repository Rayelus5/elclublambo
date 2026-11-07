import { activeSets, DEFAULT_CONTENT, possibleSets, type RelicInput, type SetBonus } from '@galaxy/sim';
import { copy } from '../copy/es';

// Relic sets in the Hangar (GDD §8.3, «Conjunto»; DESIGN_SYSTEM §8 ter): the sets the equipped galaxies make, with
// their bonus in words, and the ones a single galaxy away. Described with DEFAULT_CONTENT like the rest of the
// Hangar (M3a ruling: the view carries no content).

const names = copy.traitValues as Record<string, Record<string, string> | undefined>;

function bonusLines(bonus: SetBonus): string[] {
  const out = (bonus.stats ?? []).map((b) => copy.hangar.setBonus.stat(b.stat, b.value));
  if (bonus.magnitude) out.push(copy.hangar.setBonus.magnitude(bonus.magnitude));
  if (bonus.background) out.push(copy.hangar.setBonus.background(bonus.background));
  return out;
}

export function SetsPanel({ relics }: { relics: RelicInput[] }) {
  const active = activeSets(relics, DEFAULT_CONTENT);
  const all = possibleSets(relics, DEFAULT_CONTENT);
  const byId = new Map(relics.map((r) => [r.id, r]));
  /** A bigger tier of an active set reads as a hint inside it, not as a second entry with the same name. */
  const nextOf = (id: string, members: string[]) =>
    all.find((p) => p.id === id && p.missing && byId.get(members[0] ?? '')?.traits[p.missing.trait] === p.missing.value);
  const possible = all.filter((p) => !active.some((a) => nextOf(a.id, a.members) === p));
  const missingText = (m: { trait: string; value: string }) => copy.hangar.setMissing(m.trait, names[m.trait]?.[m.value] ?? m.value);
  return (
    <section className="hangar-sets" aria-labelledby="hangar-sets">
      <h3 id="hangar-sets">{copy.hangar.sets}</h3>
      {active.length === 0 && possible.length === 0 ? (
        <p className="hangar-help">{copy.hangar.setsEmpty}</p>
      ) : (
        <ul className="set-list">
          {active.map((s) => (
            <li key={`${s.id}:${s.members.join(',')}`} className="set-item active">
              <b>{s.name}</b>
              <span className="set-desc">{s.description}</span>
              {bonusLines(s.bonus).map((t) => (
                <span key={t} className="set-bonus">
                  {t}
                </span>
              ))}
              {(() => {
                const next = nextOf(s.id, s.members);
                return next?.missing ? <span className="set-next">{missingText(next.missing)}</span> : null;
              })()}
            </li>
          ))}
          {possible.map((s) => (
            <li key={`${s.id}:${s.missing?.value ?? ''}`} className="set-item possible">
              <b>{s.name}</b>
              {s.missing && <span className="set-desc">{missingText(s.missing)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
