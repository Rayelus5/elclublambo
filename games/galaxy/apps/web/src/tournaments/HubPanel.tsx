import { type TournamentCard, tournamentPath } from '@galaxy/shared';
import { type CSSProperties, useId } from 'react';
import { Link } from 'react-router';
import { signUpOpen, useTournaments } from '../api/tournaments';
import { copy } from '../copy/es';
import { GiftArt } from '../gifts/GiftArt';
import { usePlayerGiftView } from '../gifts/usePlayerGiftView';
import { giftWords } from '../gifts/words';
import { Icon } from '../ui/Icon';
import { CashBadge, StateChip, TimeChip, TournamentArt } from './parts';
import { ChoiceMark } from './SkinChoice';
import { blockText, featuredOf, type HubPick } from './words';

// The title screen's tournaments (the owner, 2026-11-22): a panel under the season's that takes the rest of the right
// column, with the tournament that matters most to you now over its banner (prizes waiting, the one you are playing,
// one open to sign up...), its state and time ticking, where you stand and the way in; «Ver todos» leads to the list.
// It grows with the room the menu leaves: one line on short screens, then the state and time, then the first prize.

const t = copy.tournaments;
const h = t.hub;

/** What the panel says under the title: where you stand, or why it is there. */
function lineOf(card: TournamentCard, pick: HubPick): string {
  const me = card.me;
  const entrants = t.entrants(card.entrants, card.maxEntrants);
  const scored = me?.status === 'joined' && me.rank !== null ? me : null;
  switch (pick) {
    case 'collect':
      return scored && scored.rank !== null ? h.rankFinal(scored.rank, t.value[card.metric](scored.score)) : h.participationWaiting;
    case 'playing':
    case 'results':
      return scored && scored.rank !== null ? h.rank(scored.rank, t.value[card.metric](scored.score)) : t.noScore;
    case 'open':
      return h.openLine(entrants);
    case 'joined':
      return h.joinedSoon(entrants);
    case 'past':
      return scored && scored.rank !== null ? h.rankFinal(scored.rank, t.value[card.metric](scored.score)) : entrants;
    case 'live':
      return (card.state === 'running' || card.state === 'scheduled' ? blockText(card) : null) ?? entrants;
  }
}

const ctaOf = (pick: HubPick) => (pick === 'collect' ? h.cta.collect : pick === 'open' ? h.cta.join : pick === 'past' ? h.cta.results : h.cta.see);

/** The first prize in short: its skins to choose, its gifts drawn small and its money (only where the panel is tall enough). */
function FirstPrize({ card }: { card: TournamentCard }) {
  const catalog = usePlayerGiftView();
  const first = card.prizes[0];
  if (!first) return null;
  const shown = first.gifts.slice(0, first.choice ? 2 : 3);
  const more = first.gifts.length - shown.length;
  return (
    <div className="htn-extra">
      <span className="htn-extra-label">{first.from === first.to ? h.firstPrize : t.places(first.from, first.to)}</span>
      <span className="htn-extra-gifts">
        {first.choice ? <ChoiceMark choice={first.choice} /> : null}
        {shown.map((g, i) => (
          <span key={i} className="tn-prize-gift" title={giftWords(g, catalog)}>
            <GiftArt gift={g} catalog={catalog} compact />
            <span className="sr-only">{giftWords(g, catalog)}</span>
          </span>
        ))}
        {more > 0 ? (
          <span className="tn-prize-more">
            <span aria-hidden="true">{t.more(more)}</span>
            <span className="sr-only">{t.moreLabel(more)}</span>
          </span>
        ) : null}
        {first.cash ? <CashBadge eur={first.cash.amountEur} /> : null}
      </span>
    </div>
  );
}

export function TournamentsHubPanel() {
  const q = useTournaments();
  const head = useId();
  const data = q.data;
  const featured = featuredOf(data);
  const open = signUpOpen(data);
  const running = Array.isArray(data?.running) ? data.running.length : 0;
  const upcoming = Array.isArray(data?.upcoming) ? data.upcoming.length : 0;
  const count = running > 0 ? h.running(running) : upcoming > 0 ? h.upcoming(upcoming) : null;
  const card = featured?.card ?? null;
  const pick = featured?.pick ?? null;
  const cls = ['lip', 'panel', 'hub-tn', 'enter', card ? `s-${card.state}` : 'none', pick ? `p-${pick}` : ''].filter(Boolean).join(' ');
  return (
    <section className={cls} style={{ '--d': '1.2s' } as CSSProperties} aria-labelledby={head}>
      <TournamentArt card={card ?? { banner: null, state: 'review' }} className="tn-art htn-art" />
      <div className="htn-body">
        <div className="htn-top">
          <h2 id={head} className="htn-eyebrow">
            <span className="htn-badge">
              <Icon name="trophy" />
              {open ? <i className="tn-dot" aria-hidden="true" /> : null}
            </span>
            <span className="htn-label">{t.title}</span>
          </h2>
          {count ? <span className="htn-count">{count}</span> : null}
          <Link to="/torneos" className="htn-all" data-sfx="hover" aria-label={open ? h.allOpen : h.allLabel}>
            <span className="htn-all-text">{h.all}</span>
            <Icon name="next" />
          </Link>
        </div>
        {card && pick ? (
          <div className="htn-main">
            <span className="htn-tags">
              <StateChip state={card.state} />
              <TimeChip card={card} className="tn-time htn-time" />
            </span>
            <Link to={tournamentPath(card.slug)} className="htn-go" data-sfx="hover">
              <b className="htn-name">{card.title}</b>
              <span className="sr-only">{ctaOf(pick)}</span>
            </Link>
            <span className="htn-foot">
              <span className="htn-line">{lineOf(card, pick)}</span>
              <span className="htn-cta" aria-hidden="true">
                {ctaOf(pick)}
                <Icon name="next" />
              </span>
            </span>
            {pick !== 'past' && pick !== 'collect' ? <FirstPrize card={card} /> : null}
          </div>
        ) : (
          <p className="htn-empty" role={data || q.error ? undefined : 'status'}>
            {data ? h.empty : q.error ? h.error : copy.loading}
          </p>
        )}
      </div>
    </section>
  );
}
