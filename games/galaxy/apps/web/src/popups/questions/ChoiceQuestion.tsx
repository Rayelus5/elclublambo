import type { PopupQuestionView } from '@galaxy/shared';
import { type CSSProperties, useId } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { useRadioKeys } from '../../ui/useRadioKeys';

// A choice of «Encuestas y avisos» (plan 2026-11-22, part A): its options as cards with their lip, two columns from
// four options (one row up to three). One answer: a radio group (one Tab stop, the arrows choose). Several: check boxes,
// each its own Tab stop, Space or a click toggles it. The chosen ones wear the Solar edge and their mark.

type Choice = Extract<PopupQuestionView, { type: 'choice' }>;

export function ChoiceQuestion({ q, value, onChange }: { q: Choice; value: readonly string[] | undefined; onChange: (choices: string[]) => void }) {
  const promptId = useId();
  const hintId = useId();
  const picked = value ?? [];
  const selected = q.multi ? -1 : q.options.findIndex((o) => o.id === picked[0]);
  const keys = useRadioKeys(q.options.length, selected, (i) => onChange([q.options[i]!.id]));
  const cols = q.options.length <= 3 ? q.options.length : 2;
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((c) => c !== id) : [...picked, id]);
  return (
    <div className="pop-question pop-q-choice">
      <h3 id={promptId} className="pop-prompt">
        {q.prompt}
      </h3>
      {q.multi ? (
        <p id={hintId} className="pop-hint">
          {copy.popups.multiHint}
        </p>
      ) : null}
      <div
        role={q.multi ? 'group' : 'radiogroup'}
        aria-labelledby={promptId}
        aria-describedby={q.multi ? hintId : undefined}
        className={`pop-choice${q.multi ? ' multi' : ''}`}
        style={{ '--cols': cols } as CSSProperties}
      >
        {q.options.map((o, i) => {
          const on = picked.includes(o.id);
          return q.multi ? (
            <button key={o.id} type="button" role="checkbox" aria-checked={on} className="lip pop-option" style={{ '--i': i } as CSSProperties} onClick={() => toggle(o.id)}>
              <span className="pop-mark" aria-hidden="true">
                <Icon name="tick" />
              </span>
              <span className="pop-option-label">{o.label}</span>
            </button>
          ) : (
            <button key={o.id} {...keys.item(i)} type="button" role="radio" aria-checked={on} className="lip pop-option" style={{ '--i': i } as CSSProperties} onClick={() => keys.go(i)}>
              <span className="pop-mark round" aria-hidden="true" />
              <span className="pop-option-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
