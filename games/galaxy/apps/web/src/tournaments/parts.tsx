import { type PrizeRange, type TournamentCard, tournamentPath } from '@galaxy/shared';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useGacha } from '../api/economy';
import { useTournamentEntry } from '../api/tournaments';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { GiftArt } from '../gifts/GiftArt';
import type { GiftCatalog } from '../gifts/words';
import { giftWords } from '../gifts/words';
import { Countdown } from '../ui/Countdown';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { blockText, dateTime, dayOf, exclusiveClashes, feeWords } from './words';

// The pieces the tournaments' list and page share (plan «temporadas como fichas», part 5; DESIGN_SYSTEM §8
// quinquagies): the banner (or its drawn stand-in), the state, the time, the prizes in short, my status, the
// sign-up action and the two dialogs that explain signing up and leaving before anything is sent.

const t = copy.tournaments;
type View = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;

const FEE_ICON: Record<'coins' | 'dust' | 'signal', IconName> = { coins: 'coin', dust: 'dust', signal: 'ticket' };

/** The banner the admin uploaded, or a drawn one in the state's colour; always decoration (the title is beside it). */
export function TournamentArt({ card, className = 'tn-art' }: { card: Pick<TournamentCard, 'banner' | 'state'>; className?: string }) {
  return (
    <span className={`${className} s-${card.state}${card.banner ? '' : ' drawn'}`} aria-hidden="true">
      {card.banner ? (
        <img src={card.banner} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="tn-art-mark">
          <Icon name="trophy" />
        </span>
      )}
    </span>
  );
}

export function StateChip({ state }: { state: TournamentCard['state'] }) {
  return (
    <span className={`tn-state s-${state}`}>
      {state === 'running' ? <i className="tn-live" aria-hidden="true" /> : null}
      {t.state[state]}
    </span>
  );
}

/** How long to its start or its end, ticking; when the results come; when it ended. */
export function TimeChip({ card, className = 'tn-time' }: { card: Pick<TournamentCard, 'state' | 'startsAt' | 'endsAt' | 'resultsAt'>; className?: string }) {
  if (card.state === 'scheduled') return <Countdown endsAt={card.startsAt} className={`${className} soon`} label={t.startsIn} />;
  if (card.state === 'running') return <Countdown endsAt={card.endsAt} className={`${className} live`} label={t.endsIn} />;
  if (card.state === 'review' && card.resultsAt)
    return (
      <span className={`${className} review`}>
        <Icon name="shield" />
        <span>{t.reviewTitle(dateTime(card.resultsAt))}</span>
      </span>
    );
  return (
    <span className={className}>
      <Icon name="calendar" />
      <span>{t.endedOn(dayOf(card.endsAt))}</span>
    </span>
  );
}

/** A money prize: its badge, read as a whole sentence. */
export function CashBadge({ eur }: { eur: number }) {
  return (
    <span className="tn-cash" role="img" aria-label={t.cashLabel(eur)}>
      <b aria-hidden="true">{t.cash(eur)}</b>
    </span>
  );
}

/** The first prize ranges in short (the card): each range's places, its first gifts drawn and its money. */
export function PrizeStrip({ prizes, catalog, max = 3 }: { prizes: readonly PrizeRange[]; catalog: View; max?: number }) {
  if (prizes.length === 0) return <p className="tn-no-prizes">{t.noPrizes}</p>;
  return (
    <ul className="tn-prize-strip" aria-label={t.prizesTitle}>
      {prizes.slice(0, max).map((p) => {
        const shown = p.gifts.slice(0, 2);
        const more = p.gifts.length - shown.length;
        return (
          <li key={p.from} className={p.from === 1 ? 'first' : undefined}>
            <span className="tn-place" title={t.places(p.from, p.to)}>
              {t.placesShort(p.from, p.to)}
            </span>
            <span className="tn-prize-gifts">
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
              {p.cash ? <CashBadge eur={p.cash.amountEur} /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** My place in it: in or out, my rank and score (or none yet), in its measure's words; once finished, where I ended. */
export function MyStatus({ card }: { card: TournamentCard }) {
  const me = card.me;
  // A cancelled one has no places: its page says so, and what came back.
  if (!me || card.state === 'cancelled') return null;
  const final = card.state === 'finished';
  return (
    <p className={`tn-me ${me.status}${final ? ' final' : ''}`}>
      {final && me.status === 'joined' ? (
        <span className="tn-me-status">
          <Icon name="trophy" />
        </span>
      ) : (
        <span className="tn-me-status">
          <Icon name={me.status === 'joined' ? 'check' : 'alert'} />
          {t.status[me.status]}
        </span>
      )}
      {me.status === 'joined' ? (
        me.rank !== null ? (
          <>
            <b className="tn-me-rank">{final ? t.rankFinal(me.rank) : t.rankNow(me.rank)}</b>
            <span className="tn-me-score">{t.value[card.metric](me.score)}</span>
          </>
        ) : (
          <span className="tn-me-score">{t.noScore}</span>
        )
      ) : null}
    </p>
  );
}

/** Prizes waiting on a finished tournament's page (only gifts are collected; money is paid outside the game). */
export const toCollect = (card: TournamentCard) => card.state === 'finished' && !!card.me?.rewards && card.me.rewards.gifts.length > 0 && !card.me.claimed;

/**
 * What the viewer can do now: sign up (with its fee), leave, or why not; on a finished one with prizes waiting, the way
 * to its page to collect them.
 */
export function EntryAction({
  card,
  onAsk,
  busy,
  compact = false,
  onPage = false,
}: {
  card: TournamentCard;
  onAsk: (card: TournamentCard, action: 'join' | 'leave') => void;
  busy: boolean;
  compact?: boolean;
  /** On the tournament's own page, where the prizes are collected: no way there. */
  onPage?: boolean;
}) {
  const live = card.state === 'running' || card.state === 'scheduled';
  if (!live) {
    return toCollect(card) && !onPage ? (
      <Link to={tournamentPath(card.slug)} className="lip pill small pill-solar tn-go-claim">
        <Icon name="trophy" />
        <span>{t.collect}</span>
      </Link>
    ) : null;
  }
  if (card.join.open) {
    const fee = card.entry;
    return (
      <button type="button" className={`lip pill pill-solar tn-join${compact ? ' small' : ''}`} disabled={busy} aria-label={t.joinOf(card.title, fee ? feeWords(fee) : null)} onClick={() => onAsk(card, 'join')}>
        <Icon name="plus" />
        <span>{t.join}</span>
        {fee ? (
          <span className="tn-join-fee">
            <Icon name={FEE_ICON[fee.currency]} />
            {fmt(fee.amount)}
          </span>
        ) : null}
      </button>
    );
  }
  if (card.join.block === 'joined')
    return (
      <button type="button" className={`lip pill tn-leave${compact ? ' small' : ''}`} disabled={busy} aria-label={t.leaveOf(card.title)} onClick={() => onAsk(card, 'leave')}>
        <Icon name="exit" />
        <span>{t.leave}</span>
      </button>
    );
  const why = blockText(card);
  return why ? (
    <p className="tn-block">
      <Icon name="lock" />
      <span>{why}</span>
    </p>
  ) : null;
}

/**
 * Signing up and leaving, each asked first in its dialog (the fee and that it never comes back, the tournaments an
 * exclusive one keeps you out of, from when runs count, that leaving wipes the score for good) and sent once.
 * `all`: every tournament the viewer can see (for the exclusive ones that clash).
 */
export function useEntryFlow(all: readonly TournamentCard[]): { ask: (card: TournamentCard, action: 'join' | 'leave') => void; busy: boolean; notice: ReactNode; dialogs: ReactNode } {
  const entry = useTournamentEntry();
  const wallet = useGacha().data?.wallet;
  const [asking, setAsking] = useState<{ card: TournamentCard; action: 'join' | 'leave' } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ask = (card: TournamentCard, action: 'join' | 'leave') => {
    entry.reset();
    setDone(null);
    setAsking({ card, action });
  };
  const close = () => setAsking(null);
  const confirm = () => {
    if (!asking) return;
    const { card, action } = asking;
    entry.mutate(
      { id: card.id, action },
      {
        onSuccess: () => {
          setAsking(null);
          setDone(action === 'leave' ? t.leftDone(card.title) : card.state === 'scheduled' ? t.joinedSoon(card.title) : t.joined(card.title));
        },
      },
    );
  };
  const error = entry.error ? (
    <p className="field-error" role="alert">
      {errorText(entry.error, copy.errors)}
    </p>
  ) : null;
  let dialogs: ReactNode = null;
  if (asking?.action === 'join') {
    const c = asking.card;
    const fee = c.entry;
    const have = fee ? (wallet?.[fee.currency] ?? null) : null;
    const short = fee && have !== null && have < fee.amount ? fee.amount - have : 0;
    dialogs = (
      <Dialog title={t.joinDialog.title(c.title)} className="tn-dialog" onClose={close}>
        <ul className="tn-points">
          <li>
            <Icon name={fee ? FEE_ICON[fee.currency] : 'coin'} />
            <span>{fee ? t.joinDialog.fee(feeWords(fee)) : t.joinDialog.free}</span>
          </li>
          {c.exclusive ? (
            <li>
              <Icon name="lock" />
              <span>{t.joinDialog.exclusive(exclusiveClashes(c, all))}</span>
            </li>
          ) : null}
          <li>
            <Icon name="comet" />
            <span>{c.metric === 'season_points' ? t.joinDialog.wholeSeason : c.state === 'scheduled' ? t.joinDialog.fromStart : t.joinDialog.fromNow}</span>
          </li>
          <li className="warn">
            <Icon name="alert" />
            <span>{t.joinDialog.leaveWarning}</span>
          </li>
        </ul>
        {short > 0 && fee ? (
          <p className="tn-short" role="status">
            {t.joinDialog.short(feeWords({ currency: fee.currency, amount: short }))}
          </p>
        ) : null}
        {error}
        <div className="modal-actions">
          <button type="button" className="lip pill" data-autofocus onClick={close}>
            {t.joinDialog.cancel}
          </button>
          <button type="button" className="lip pill pill-solar" disabled={entry.isPending || short > 0} aria-busy={entry.isPending || undefined} onClick={confirm}>
            {fee ? <Icon name={FEE_ICON[fee.currency]} /> : <Icon name="plus" />}
            <span>{fee ? t.joinDialog.confirmFee(feeWords(fee)) : t.joinDialog.confirm}</span>
          </button>
        </div>
      </Dialog>
    );
  } else if (asking?.action === 'leave') {
    const c = asking.card;
    dialogs = (
      <Dialog title={t.leaveDialog.title(c.title)} role="alertdialog" className="tn-dialog" onClose={close}>
        <ul className="tn-points">
          <li className="warn">
            <Icon name="alert" />
            <span>{t.leaveDialog.body}</span>
          </li>
          {c.entry ? (
            <li>
              <Icon name={FEE_ICON[c.entry.currency]} />
              <span>{t.leaveDialog.fee}</span>
            </li>
          ) : null}
        </ul>
        {error}
        <div className="modal-actions">
          <button type="button" className="lip pill" data-autofocus onClick={close}>
            {t.leaveDialog.stay}
          </button>
          <button type="button" className="lip pill danger" disabled={entry.isPending} aria-busy={entry.isPending || undefined} onClick={confirm}>
            <Icon name="exit" />
            <span>{t.leaveDialog.confirm}</span>
          </button>
        </div>
      </Dialog>
    );
  }
  const notice = done ? (
    <p className="missions-gained tn-done" role="status" aria-atomic="true">
      {done}
    </p>
  ) : null;
  return { ask, busy: entry.isPending, notice, dialogs };
}
