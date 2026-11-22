import type { PopupQuestionView } from '@galaxy/shared';
import { type CSSProperties, useId } from 'react';
import { copy } from '../../copy/es';
import { useRadioKeys } from '../../ui/useRadioKeys';
import { SubjectCard } from './SubjectCard';

// A scale of «Encuestas y avisos» (plan 2026-11-22, part A; the owner's mock-ups 1 and 2): the question in the display
// letters, maybe what it is about (an enemy, a Core, a probe or a sector, drawn), and a row of round buttons, 1 to 5 or
// 0 to 10, the chosen one in Solar with its lip; the words of the ends under the first and the last. A radio group:
// one Tab stop, the arrows, Home and End choose; the ends describe it.

const t = copy.popups;
type Scale = Extract<PopupQuestionView, { type: 'scale' }>;

/** `big`: the survey's bare screen, the question as the hero (else a question inside a panel). */
export function ScaleQuestion({ q, value, onChange, big = false }: { q: Scale; value: number | undefined; onChange: (score: number) => void; big?: boolean }) {
  const promptId = useId();
  const endsId = useId();
  const [min, max]: [number, number] = q.range === '0-10' ? [0, 10] : [1, 5];
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const keys = useRadioKeys(values.length, value === undefined ? -1 : value - min, (i) => onChange(min + i));
  const ends = q.low || q.high ? t.ends(min, q.low, max, q.high) : '';
  return (
    <div className={`pop-question pop-q-scale${big ? ' pop-big' : ''}`}>
      <h3 id={promptId} className="pop-prompt">
        {q.prompt}
      </h3>
      {q.subject ? <SubjectCard subject={q.subject} /> : null}
      <div className={`pop-scale-wrap${values.length > 5 ? ' pop-wide' : ''}`} style={{ '--n': values.length } as CSSProperties}>
        <div role="radiogroup" aria-labelledby={promptId} aria-describedby={ends ? endsId : undefined} className="pop-scale">
          {values.map((v, i) => (
            <button
              key={v}
              {...keys.item(i)}
              type="button"
              role="radio"
              aria-checked={value === v}
              className="lip pop-dot"
              style={{ '--i': i } as CSSProperties}
              onClick={() => keys.go(i)}
            >
              {v}
            </button>
          ))}
        </div>
        {ends ? (
          <>
            <div className="pop-ends" aria-hidden="true">
              <span className="pop-end-low">{q.low}</span>
              <span className="pop-end-high">{q.high}</span>
            </div>
            <span id={endsId} className="sr-only">
              {ends}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
