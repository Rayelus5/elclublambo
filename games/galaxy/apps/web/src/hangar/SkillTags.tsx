import type { Content, RelicSkill } from '@galaxy/sim';
import { useState } from 'react';
import { singularityOf } from '../api/content-read';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

// A relic's skills (the owner: «no se muestran las habilidades… permitir pulsar en cada tag», then «en una sola»): its
// passive (from the galaxy's type), its element (palette), its phenomenon, a mythic's own power (plan «rareza Mítica»
// M2, with its time from the live content) and its power, behind one chip that opens what each does, where it comes
// from, and for an echo which passive it copies now.

const h = copy.hangar;
const i = h.skillInfo;

type Kind = keyof typeof i.kinds;
export interface SkillTag {
  kind: Kind;
  id: string;
  name: string;
  text: string;
  extra?: string;
}

export function skillTags(skill: RelicSkill, content: Content): SkillTag[] {
  const tags: SkillTag[] = [
    {
      kind: 'family',
      id: skill.family,
      name: h.families[skill.family],
      text: i.family[skill.family],
      ...(skill.family === 'echo' && skill.copies ? { extra: i.echoCopies(h.families[skill.copies]) } : {}),
    },
  ];
  if (skill.element) tags.push({ kind: 'element', id: skill.element, name: h.elements[skill.element], text: i.element[skill.element] });
  if (skill.phenomenon) tags.push({ kind: 'phenomenon', id: skill.phenomenon, name: h.phenomena[skill.phenomenon], text: i.phenomenon[skill.phenomenon] });
  if (skill.mythic) tags.push({ kind: 'mythic', id: 'singularity', name: i.mythicName, text: i.singularity(singularityOf(content).cooldown) });
  tags.push({ kind: 'power', id: 'power', name: h.power(skill.magnitude), text: i.power });
  return tags;
}

/**
 * A relic's powers in one chip (the owner: «todas las etiquetas… en una sola»): its passive's name and how many more
 * it has. Pressing it opens every power with what it does and where it comes from.
 */
export function SkillsChip({ skill, galaxy, content }: { skill: RelicSkill; galaxy: string; content: Content }) {
  const [open, setOpen] = useState(false);
  const all = skillTags(skill, content);
  const tags = all.filter((x) => x.kind !== 'power');
  const first = tags[0]!;
  return (
    <>
      <button type="button" className="skills-chip" aria-haspopup="dialog" aria-label={i.open(galaxy)} title={i.open(galaxy)} onClick={() => setOpen(true)}>
        <span className="skills-chip-name">{first.name}</span>
        {tags.length > 1 ? <span className="skills-chip-more">+{tags.length - 1}</span> : null}
      </button>
      {open ? (
        <Dialog title={i.title(galaxy)} onClose={() => setOpen(false)} className="skill-info">
          <ul className="skill-list" aria-label={i.tags(galaxy)}>
            {all.map((x) => (
              <li key={x.kind} className={`skill-row k-${x.kind}${x.kind === 'element' || x.kind === 'phenomenon' ? ` is-${x.id}` : ''}`}>
                <span className={`skill-kind k-${x.kind}`}>{i.kinds[x.kind]}</span>
                <b className="skill-name">{x.name}</b>
                <p className="skill-text">{x.text}</p>
                {x.extra ? <p className="skill-extra">{x.extra}</p> : null}
                <p className="skill-from">{i.from[x.kind]}</p>
              </li>
            ))}
          </ul>
          <button type="button" className="lip pill" data-autofocus onClick={() => setOpen(false)}>
            {copy.collection.close}
          </button>
        </Dialog>
      ) : null}
    </>
  );
}
