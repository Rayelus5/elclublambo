import type { BoostsView, NewsSection, TitleNotice } from '@galaxy/shared';
import { type CSSProperties, useEffect, useId, useState } from 'react';
import { useNotices } from '../api/mail';
import { useNews as useNewsPosts } from '../api/news';
import { type BoardCard, boardCard, useAutoData } from '../news/cards';
import { NewsCard } from '../news/NewsCard';
import { useReducedMotion } from '../ui/motion';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';

// Noticias (open beta; a board since the owner's ask of 2026-11-14): behind a button of the top bar, next to Comunidad
// and Amigos, which says how many things are new to this browser. It opens the news board: the team's notices (an
// important one marked), the featured cards turning in a carousel, and each section's cards (Comunidad, Eventos y
// torneos, Novedades), all set up by the admin, some saying what the game has now (patch notes, events, season,
// multipliers, Discord). Opening it counts everything in it as seen. The multipliers' and the anomaly's cards below
// are also what «Condiciones de hoy» shows.

const t = copy.news;
const KEY = 'gs.news.seen';
// When a multiplier ends, in full: «martes 17 de noviembre» and «00:00».
const endDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const endTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const ends = (iso: string) => t.until(endDay.format(new Date(iso)).replace(',', ''), endTime.format(new Date(iso)));
const CURRENCY_ICON: Record<string, IconName> = { coins: 'coin', dust: 'dust', signal: 'radar', material: 'station' };
const seasonDay = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

type Boost = BoostsView['boosts'][number];
export type Anomaly = NonNullable<BoostsView['anomaly']>;
/** The multipliers of one launch (same name, same end), shown and counted as one piece of news. */
export interface BoostGroup {
  key: string;
  name: string;
  endsAt: string;
  items: Boost[];
}

export function groupBoosts(boosts: Boost[]): BoostGroup[] {
  const groups = new Map<string, BoostGroup>();
  for (const b of boosts) {
    const key = `${b.name}|${b.endsAt}`;
    const g = groups.get(key) ?? { key, name: b.name, endsAt: b.endsAt, items: [] };
    g.items.push(b);
    groups.set(key, g);
  }
  return [...groups.values()];
}

const noticeId = (n: TitleNotice) => `n:${n.id}`;
/** How long the featured carousel shows each card (ms). */
const HERO_MS = 8000;

function readSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveSeen(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Private windows: seen for this visit only.
  }
}

/** What there is now and what of it this browser has not seen: the notices and the board's cards. */
function useBoard(seen: string[]) {
  const notices = useNotices().data ?? [];
  const posts = useNewsPosts().data?.posts ?? [];
  const data = useAutoData();
  const cards = posts.map((p) => boardCard(p, data)).filter((c): c is BoardCard => c !== null);
  const isNewNotice = (n: TitleNotice) => !seen.includes(noticeId(n));
  const isNewCard = (c: BoardCard) => !seen.includes(c.seenKey);
  const fresh = notices.filter(isNewNotice).length + cards.filter(isNewCard).length;
  const ids = [...notices.map(noticeId), ...cards.map((c) => c.seenKey)];
  return { notices, cards, fresh, ids, isNewNotice, isNewCard };
}

export function NewsButton({ style }: { style?: CSSProperties }) {
  const [seen, setSeen] = useState<string[]>(readSeen);
  // What was seen before this opening, so the board can still mark what is new in it.
  const [shownWith, setShownWith] = useState<string[] | null>(null);
  const news = useBoard(seen);
  const label = t.buttonLabel(news.fresh);
  return (
    <>
      <button
        type="button"
        className="lip pill fold enter news-button"
        style={style}
        aria-haspopup="dialog"
        aria-expanded={shownWith !== null}
        aria-label={label}
        title={label}
        onClick={() => {
          setShownWith(seen);
          const next = [...new Set([...seen, ...news.ids])];
          setSeen(next);
          saveSeen(next);
        }}
      >
        <Icon name="megaphone" />
        <span className="label">{t.button}</span>
        {news.fresh > 0 ? (
          <span className="news-badge" aria-hidden="true">
            {news.fresh > 9 ? '9+' : news.fresh}
          </span>
        ) : null}
      </button>
      {shownWith ? <NewsDialog seen={shownWith} onClose={() => setShownWith(null)} /> : null}
    </>
  );
}

const SECTIONS: NewsSection[] = ['comunidad', 'eventos', 'novedades'];

/**
 * The news board (the owner, 2026-11-14: «más grande, llamativo, y profesional, como un tablón de anuncios»): the
 * team's notices on top, the featured cards in a carousel, then each section's cards in a grid.
 */
function NewsDialog({ seen, onClose }: { seen: string[]; onClose: () => void }) {
  const { notices, cards, isNewNotice, isNewCard } = useBoard(seen);
  const ids = useId();
  const hero = [...cards.filter((c) => c.section === 'destacado'), ...cards.filter((c) => c.section !== 'destacado' && c.featured)];
  return (
    <Dialog title={t.title} onClose={onClose} className="news board">
      <button type="button" className="lip iconbtn modal-close" aria-label={t.close} title={t.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      {notices.length === 0 && cards.length === 0 ? (
        <div className="news-empty">
          <Icon name="megaphone" />
          <p>
            <b>{t.empty}</b>
            <span>{t.emptyHint}</span>
          </p>
        </div>
      ) : null}
      {notices.length > 0 ? (
        <section className="news-section" aria-labelledby={`${ids}-notices`}>
          <h3 id={`${ids}-notices`} className="sr-only">
            {t.notices}
          </h3>
          <ul className="news-list news-notices">
            {notices.map((n) => (
              <li key={n.id} className={`news-notice ${n.tone}`}>
                <Icon name={n.tone === 'warning' ? 'alert' : 'info'} />
                <div>
                  {n.tone === 'warning' || isNewNotice(n) ? (
                    <p className="news-tags">
                      {n.tone === 'warning' ? <span className="news-tag important">{t.important}</span> : null}
                      {isNewNotice(n) ? <span className="news-tag fresh">{t.fresh}</span> : null}
                    </p>
                  ) : null}
                  <p className="news-text">{n.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hero.length > 0 ? <Carousel cards={hero} isNew={isNewCard} onNavigate={onClose} /> : null}
      {/* The sections side by side, like the columns of a board (one under another when narrow). */}
      <div className="news-columns">
        {SECTIONS.map((section) => {
          const list = cards.filter((c) => c.section === section && !c.featured);
          if (list.length === 0) return null;
          return (
            <section key={section} className={`news-section news-column section-${section}`} aria-labelledby={`${ids}-${section}`}>
              <h3 id={`${ids}-${section}`}>{t.board.sections[section]}</h3>
              <div className="news-grid">
                {list.map((c, i) => (
                  <NewsCard key={c.id} card={c} fresh={isNewCard(c)} onNavigate={onClose} style={{ '--i': i } as CSSProperties} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}

/** The featured cards, one at a time, turning by themselves (never with reduced motion, nor while hovered or focused). */
function Carousel({ cards, isNew, onNavigate }: { cards: BoardCard[]; isNew: (c: BoardCard) => boolean; onNavigate: () => void }) {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();
  const n = cards.length;
  const shown = cards[Math.min(at, n - 1)]!;
  useEffect(() => {
    if (n < 2 || held || reduced) return;
    const id = setTimeout(() => setAt((a) => (a + 1) % n), HERO_MS);
    return () => clearTimeout(id);
  }, [at, n, held, reduced]);
  return (
    <section
      className="news-hero"
      aria-roledescription="carrusel"
      aria-label={t.board.featured}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <NewsCard key={shown.id} card={shown} variant="hero" fresh={isNew(shown)} onNavigate={onNavigate} />
      {n > 1 ? (
        <div className="news-hero-nav">
          <button type="button" className="lip iconbtn small" aria-label={t.board.prev} onClick={() => setAt((a) => (a + n - 1) % n)}>
            <Icon name="back" />
          </button>
          <div className="news-hero-dots">
            {cards.map((c, i) => (
              <button key={c.id} type="button" aria-label={t.board.goTo(i + 1, n)} aria-current={i === at ? 'true' : undefined} onClick={() => setAt(i)} />
            ))}
          </div>
          <button type="button" className="lip iconbtn small" aria-label={t.board.next} onClick={() => setAt((a) => (a + 1) % n)}>
            <Icon name="next" />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** The multipliers running now, one card per launch: its name, each currency's factor and when it ends. */
export function BoostCards({ groups, isNew }: { groups: BoostGroup[]; isNew?: (g: BoostGroup) => boolean }) {
  return (
    <ul className="news-list">
      {groups.map((g) => (
        <li key={g.key} className="news-boost">
          <p className="news-boost-head">
            <b>{g.name}</b>
            {isNew?.(g) ? <span className="news-tag fresh">{t.fresh}</span> : null}
          </p>
          <ul className="news-rates">
            {g.items.map((b) => (
              <li key={b.id} className={`news-rate ${b.currency}`}>
                <Icon name={CURRENCY_ICON[b.currency] ?? 'star'} />
                <span>{t.rate(b.currency, b.factor)}</span>
              </li>
            ))}
          </ul>
          <p className="news-until">{ends(g.endsAt)}</p>
        </li>
      ))}
    </ul>
  );
}

/** The season's anomaly: its name, what it does to every run, and until when (the season's end, when known). */
export function AnomalyCard({ anomaly, endsAt, fresh = false }: { anomaly: Anomaly; endsAt?: string; fresh?: boolean }) {
  return (
    <div className="today-card today-anomaly-card">
      <Icon name="alert" />
      <div>
        <p className="news-boost-head">
          <b>{anomaly.name}</b>
          {fresh ? <span className="news-tag fresh">{t.fresh}</span> : null}
        </p>
        <p className="today-desc">{anomaly.description}</p>
        <p className="today-note">{copy.anomaly.note}</p>
        {endsAt ? <p className="news-until">{copy.anomaly.until(seasonDay.format(new Date(endsAt)))}</p> : null}
      </div>
    </div>
  );
}
