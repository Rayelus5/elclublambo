import { type CSSProperties, useId } from 'react';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import type { BoardCard } from './cards';

// One card of the news board (the owner, 2026-11-14): its image (the game's own or an uploaded one; its section's
// colours when it has none) with a small tag, its title, its text and lines, and where it leads. The whole card is
// pressable when it leads somewhere (its link covers it): inside the game it goes there and the board closes; a URL
// opens in a new tab. «hero»: the big one of the featured carousel; «tile»: one of a section's grid.

const t = copy.news.board;

export function NewsCard({ card, variant = 'tile', fresh = false, onNavigate, style }: { card: BoardCard; variant?: 'hero' | 'tile'; fresh?: boolean; onNavigate?: () => void; style?: CSSProperties }) {
  const id = useId();
  return (
    <article className={`news-card news-card-${variant} section-${card.section}${card.href ? ' linked' : ''}`} aria-labelledby={id} style={style}>
      <div className="news-card-art" aria-hidden="true">
        {card.image ? <img src={card.image} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="news-card-fallback" />}
        {card.badge ? <span className="news-card-badge">{card.badge}</span> : null}
      </div>
      <div className="news-card-body">
        {fresh ? <span className="news-tag fresh">{copy.news.fresh}</span> : null}
        <h4 id={id}>{card.title}</h4>
        {card.body ? <p className="news-card-text">{card.body}</p> : null}
        {card.lines.length > 0 ? (
          <ul className="news-card-lines">
            {card.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null}
        {card.href && card.cta ? (
          card.external ? (
            <a className="news-card-cta" href={card.href} target="_blank" rel="noopener noreferrer" aria-label={`${card.cta}. ${t.opensOutside}`}>
              <span>{card.cta}</span>
              <Icon name="next" />
            </a>
          ) : (
            <Link className="news-card-cta" to={card.href} onClick={onNavigate}>
              <span>{card.cta}</span>
              <Icon name="next" />
            </Link>
          )
        ) : null}
      </div>
    </article>
  );
}
