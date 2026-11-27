import { Icon } from '../../ui/Icon';
import type { GainRow } from './gains';

/**
 * What a level-up gives, as before-and-after rows (design C, the owner's pick, 2026-11-27): each number's name, what
 * you have, an arrow icon and what you get in green; an evolution's trait first. Every row is drawn for the eye and
 * said whole for screen readers («+20 % de daño»), so a card's name reads as a sentence, not as loose numbers.
 */
export function GainRows({ rows, className = '' }: { rows: readonly GainRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <ul className={`gain-rows ${className}`.trim()}>
      {rows.map((r, i) =>
        r.kind === 'trait' ? (
          <li key={i} className="gain-trait">
            {r.text}
          </li>
        ) : (
          <li key={i}>
            <span className="gain-label" aria-hidden="true">
              {r.label}
            </span>
            <span className="gain-values" aria-hidden="true">
              {r.from ? (
                <>
                  <span className="gain-from">{r.from}</span>
                  <Icon name="arrow" className="ico gain-arrow" />
                </>
              ) : null}
              <span className="gain-to">{r.to}</span>
            </span>
            <span className="sr-only">{r.say}</span>
          </li>
        ),
      )}
    </ul>
  );
}
