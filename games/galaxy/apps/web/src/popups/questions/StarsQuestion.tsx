import type { PopupQuestionView } from '@galaxy/shared';
import { type CSSProperties, useId, useState } from 'react';
import { copy } from '../../copy/es';
import { useRadioKeys } from '../../ui/useRadioKeys';

// The stars of a review (plan 2026-11-22, part A; the owner's mock-up of a review): five chunky stars with their lip,
// gold up to the one chosen, and up to the one under the pointer while it moves over them. A radio group named by its
// question, each star by its number («4 estrellas»); one Tab stop, the arrows, Home and End choose.

const STARS = [1, 2, 3, 4, 5] as const;
/** A five-pointed star, plump (rounded by its thick stroke), in a 48 box. */
const STAR = 'M24 5L29.6 17.3L43 18.8L33 27.9L35.8 41.2L24 34.5L12.2 41.2L15 27.9L5 18.8L18.4 17.3Z';

type Stars = Extract<PopupQuestionView, { type: 'stars' }>;

export function StarsQuestion({ q, value, onChange }: { q: Stars; value: number | undefined; onChange: (score: number) => void }) {
  const promptId = useId();
  // An id the SVG's url() reads as it is (React's ids carry punctuation).
  const gid = `pop-star-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [hover, setHover] = useState<number | null>(null);
  const keys = useRadioKeys(STARS.length, value === undefined ? -1 : value - 1, (i) => onChange(i + 1));
  const lit = hover ?? value ?? 0;
  return (
    <div className="pop-question pop-q-stars">
      <h3 id={promptId} className="pop-prompt">
        {q.prompt}
      </h3>
      <div role="radiogroup" aria-labelledby={promptId} className="pop-stars" onPointerLeave={() => setHover(null)}>
        <svg className="pop-star-defs" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${gid}on`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="pop-star-on-1" />
              <stop offset="1" className="pop-star-on-2" />
            </linearGradient>
          </defs>
        </svg>
        {STARS.map((n, i) => (
          <button
            key={n}
            {...keys.item(i)}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={copy.popups.stars(n)}
            className={`pop-star${n <= lit ? ' on' : ''}${hover !== null && n <= hover ? ' preview' : ''}`}
            style={{ '--i': i } as CSSProperties}
            onPointerEnter={() => setHover(n)}
            onClick={() => keys.go(i)}
          >
            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <path className="pop-star-lip" d={STAR} transform="translate(0 3)" />
              <path className="pop-star-body" d={STAR} fill={n <= lit ? `url(#${gid}on)` : undefined} />
              <ellipse className="pop-star-shine" cx="19" cy="19.5" rx="3.6" ry="1.9" transform="rotate(-38 19 19.5)" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
