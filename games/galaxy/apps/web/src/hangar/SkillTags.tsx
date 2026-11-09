import type { RelicSkill } from '@galaxy/sim';
import { useState } from 'react';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

// A relic's skills as tags (the owner: «no se muestran las habilidades… permitir pulsar en cada tag»): its passive
// (from the galaxy's type), its element (palette), its phenomenon and its power. Each tag opens what it does, where
// it comes from, and for an echo which passive it copies now.

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

export function skillTags(skill: RelicSkill): SkillTag[] {
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
  tags.push({ kind: 'power', id: 'power', name: h.power(skill.magnitude), text: i.power });
  return tags;
}

export function SkillTags({ skill, galaxy }: { skill: RelicSkill; galaxy: string }) {
  const [open, setOpen] = useState<SkillTag | null>(null);
  return (
    <>
      <ul className="skill-tags" aria-label={i.tags(galaxy)}>
        {skillTags(skill).map((t) => (
          <li key={t.kind}>
            <button
              type="button"
              className={`skill-tag k-${t.kind}${t.kind === 'element' || t.kind === 'phenomenon' ? ` is-${t.id}` : ''}${t.kind === 'power' ? ' lobby-slot-power' : ''}`}
              aria-haspopup="dialog"
              title={i.more(t.name)}
              onClick={() => setOpen(t)}
            >
              {t.name}
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <Dialog title={open.name} onClose={() => setOpen(null)} className="skill-info">
          <span className={`skill-kind k-${open.kind}`}>{i.kinds[open.kind]}</span>
          <p className="skill-text">{open.text}</p>
          {open.extra ? <p className="skill-extra">{open.extra}</p> : null}
          <p className="skill-from">{i.from[open.kind]}</p>
          <button type="button" className="lip pill" data-autofocus onClick={() => setOpen(null)}>
            {copy.collection.close}
          </button>
        </Dialog>
      ) : null}
    </>
  );
}
