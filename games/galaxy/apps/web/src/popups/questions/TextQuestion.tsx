import type { PopupQuestionView } from '@galaxy/shared';
import { useId } from 'react';
import { copy } from '../../copy/es';

// A text of «Encuestas y avisos» (plan 2026-11-22, part A; the owner's mock-up of a review): the question as its
// visible label, a roomy sunken box with the admin's placeholder, and how much is written of how much fits («120 de
// 500»), which warms to Solar near the end. «Opcional» says when it can stay empty.

const t = copy.popups;
type Text = Extract<PopupQuestionView, { type: 'text' }>;

export function TextQuestion({ q, value, onChange }: { q: Text; value: string | undefined; onChange: (text: string) => void }) {
  const id = useId();
  const countId = useId();
  const n = value?.length ?? 0;
  return (
    <div className="pop-question pop-q-text">
      <label htmlFor={id} className="pop-prompt">
        {q.prompt}
        {/* Not required is what the box already says to screen readers: the word is for the eyes. */}
        {q.required ? null : (
          <span className="pop-optional" aria-hidden="true">
            {t.optional}
          </span>
        )}
      </label>
      <div className="pop-text">
        <textarea
          id={id}
          value={value ?? ''}
          maxLength={q.maxLength}
          placeholder={q.placeholder || t.placeholder}
          required={q.required}
          aria-describedby={countId}
          rows={5}
          onChange={(e) => onChange(e.target.value)}
        />
        <span id={countId} className={`pop-count${n >= q.maxLength * 0.9 ? ' near' : ''}`}>
          <span aria-hidden="true">{t.count(n, q.maxLength)}</span>
          <span className="sr-only">{t.countLabel(n, q.maxLength)}</span>
        </span>
      </div>
    </div>
  );
}
