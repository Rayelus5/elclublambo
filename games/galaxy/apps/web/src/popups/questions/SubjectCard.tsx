import type { PopupSubjectView } from '@galaxy/shared';
import { spriteDef } from '../../arena/sprites';
import { copy } from '../../copy/es';
import { useReducedMotion } from '../../ui/motion';
import { SpriteLoop } from '../../ui/SpriteLoop';

// What a scale is about (plan 2026-11-22, part A; the owner's mock-up 2): the enemy, the Core, the probe or the sector
// drawn as in the arena, alive (still with reduced motion) in a framed tile, with its kind in its colour and its name.

/** The tile's inside (px): the drawing at the largest whole scale that fits, so its pixels stay square. */
const TILE = 80;

export function SubjectCard({ subject }: { subject: PopupSubjectView }) {
  const reduced = useReducedMotion();
  const def = spriteDef(subject.sprite);
  const scale = def ? Math.max(1, Math.floor(TILE / Math.max(def.w, def.h))) : 1;
  return (
    <div className="pop-subject" data-kind={subject.kind}>
      {def ? (
        <span className="pop-subject-art" aria-hidden="true">
          <SpriteLoop id={subject.sprite} scale={scale} reduced={reduced} width={def.w * scale} height={def.h * scale} />
        </span>
      ) : null}
      <span className="pop-subject-words">
        <span className="pop-subject-kind">{copy.popups.subject[subject.kind]}</span>
        <span className="pop-subject-name">{subject.name}</span>
      </span>
    </div>
  );
}
