import type { MailContents, MailType } from '@galaxy/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { GiftTile } from '../gifts/GiftArt';
import type { GiftCatalog } from '../gifts/words';
import { Icon } from '../ui/Icon';
import { giftUrl } from './art';
import { MAIL_TYPE_LOOK, mailTypeName } from './types';

// A letter as its reader sees it (mail v2): the stamp of its kind in its colour, its title, date and text as written,
// and its gift — the loose gifts and each pack under its name — with whatever action goes under it (claiming, in the
// mailbox; nothing, in the panel's preview). A season's or a tournament's letter leads to the page of its prizes.

const t = copy.mail;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));

type View = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;

export function LetterView({
  type,
  title,
  body,
  at,
  expiresAt,
  contents,
  catalog,
  taken = false,
  link = null,
  onGo,
  children,
}: {
  type: MailType;
  title: string;
  body: string;
  at: string;
  expiresAt: string;
  contents: MailContents;
  catalog: View;
  /** Its gift was claimed: shown dimmed. */
  taken?: boolean;
  /** The in-game page its button opens (a tournament's results: `/torneos/<slug>`). */
  link?: string | null;
  /** Leaving for that page (or the season's): the mailbox closes behind. */
  onGo?: () => void;
  /** Under the gift: «Recoger» or what it gave. */
  children?: ReactNode;
}) {
  const look = MAIL_TYPE_LOOK[type];
  const any = contents.items.length > 0 || contents.packs.some((p) => p.items.length > 0);
  return (
    <article className={`letter k-${look.tone}`} data-type={type}>
      <p className="letter-stamp">
        <Icon name={look.icon} />
        <span>{mailTypeName(type)}</span>
      </p>
      <h3>{title}</h3>
      <p className="letter-meta">
        <time dateTime={at}>{day(at)}</time>
        <span>{t.expires(day(expiresAt))}</span>
      </p>
      <p className="letter-body">{body}</p>
      {type === 'season' ? (
        <Link to="/temporada" className="lip pill pill-solar letter-go" onClick={onGo}>
          <Icon name="podium" />
          <span>{t.goSeason}</span>
        </Link>
      ) : null}
      {/* A tournament's results (plan «temporadas como fichas», part 5): the prizes are collected on its page. */}
      {type === 'tournament' && link?.startsWith('/torneos/') ? (
        <Link to={link} className="lip pill pill-solar letter-go" onClick={onGo}>
          <Icon name="trophy" />
          <span>{t.goTournament}</span>
        </Link>
      ) : null}
      {any ? (
        <section className={`gift${taken ? ' taken' : ''}`} aria-label={t.giftTitle}>
          <span className="gift-art" aria-hidden="true" style={giftUrl ? { backgroundImage: `url(${giftUrl})` } : undefined} />
          <div className="gift-contents">
            {contents.items.length > 0 ? (
              <ul className="gift-grid-list">
                {contents.items.map((g, i) => (
                  <GiftTile key={i} gift={g} catalog={catalog} />
                ))}
              </ul>
            ) : null}
            {contents.packs.map((p) => (
              <div key={p.id} className="gift-pack-group">
                <b className="gift-pack-name">{copy.gifts.pack(p.name)}</b>
                <ul className="gift-grid-list">
                  {p.items.map((g, i) => (
                    <GiftTile key={i} gift={g} catalog={catalog} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {children}
        </section>
      ) : null}
    </article>
  );
}
