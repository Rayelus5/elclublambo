import { mediaUrl, type TournamentRecord, type TournamentState } from '@galaxy/shared';
import { type GiftCatalog, giftWords } from '../../gifts/words';
import { Icon } from '../../ui/Icon';
import { euros, feeWords, shortDay, t, until } from './shared';
import { GiftLine } from './GiftsField';

// A tournament as players will see it (plan «temporadas como fichas», part 5: «la tarjeta y la página como las verá el
// jugador»): its card in the list (banner, state, dates and countdown, measure, sign-up, the first place's prize) and,
// below, its rules and prize table as its page shows them. The panel draws it from the record being edited.

const c = t.card;

/** The card of the players' list, drawn from a record. */
export function PlayerCard({ record, state, entrants, catalog, now }: { record: TournamentRecord; state: Exclude<TournamentState, 'draft'>; entrants: number; catalog: GiftCatalog | null; now: number }) {
  const first = record.prizes[0];
  const banner = record.bannerMedia ? mediaUrl(record.bannerMedia) : null;
  const countdown = state === 'scheduled' ? t.startsIn(until(record.startsAt, now)) : state === 'running' ? t.endsIn(until(record.endsAt, now)) : null;
  return (
    <article className="atn-card" data-state={state}>
      <div className="atn-card-banner">
        {banner ? <img src={banner} alt="" draggable={false} /> : <span className="atn-card-sky" aria-hidden="true" />}
        <span className="atn-card-chips">
          <span className="atn-chip" data-state={state}>
            {c.states[state]}
          </span>
          {record.exclusive ? (
            <span className="atn-chip excl">
              <Icon name="lock" />
              <span>{t.exclusiveMark}</span>
            </span>
          ) : null}
        </span>
      </div>
      <div className="atn-card-body">
        <h3>{record.title.trim() || c.untitled}</h3>
        {record.summary ? <p className="atn-card-summary">{record.summary}</p> : null}
        <ul className="atn-card-facts">
          <li>
            <Icon name="calendar" />
            <span>
              {c.dates(shortDay(record.startsAt), shortDay(record.endsAt))}
              {countdown ? <small>{countdown}</small> : null}
            </span>
          </li>
          <li>
            <Icon name="target" />
            <span>{t.metrics[record.metric].name}</span>
          </li>
          <li>
            <Icon name="clan" />
            <span>{c.entrants(entrants, record.maxEntrants)}</span>
          </li>
          <li>
            <Icon name="ticket" />
            <span>{record.entry ? c.entry(feeWords(record.entry)) : t.free}</span>
          </li>
          {record.filters.minLevel ? (
            <li>
              <Icon name="up" />
              <span>{c.level(record.filters.minLevel)}</span>
            </li>
          ) : null}
        </ul>
        {first ? (
          <div className="atn-card-prize">
            <b>{c.firstPrize}</b>
            {catalog ? <GiftLine gifts={first.gifts} catalog={catalog} /> : null}
            {first.cash ? <span className="atn-cash-chip">{euros(first.cash.amountEur)}</span> : null}
            {record.prizes.length > 1 ? <small>{c.morePrizes(record.prizes.length - 1)}</small> : null}
          </div>
        ) : (
          <p className="atn-card-prize none">{t.noPrizes}</p>
        )}
        {/* Drawn as the players' button, never pressed here. */}
        <span className="lip pill pill-solar atn-card-join" aria-hidden="true">
          {c.join}
        </span>
      </div>
    </article>
  );
}

/** The prize table of the tournament's page: each range of places with what it gives, and the participation prize. */
export function PrizeTable({ record, catalog }: { record: TournamentRecord; catalog: GiftCatalog }) {
  if (record.prizes.length === 0 && !record.participation) return <p className="panel-note">{t.noPrizes}</p>;
  return (
    <table className="admin-table atn-prize-table">
      <caption className="sr-only">{t.prizeTable}</caption>
      <thead>
        <tr>
          <th scope="col">{t.panel.cols.rank}</th>
          <th scope="col">{t.panel.cols.prize}</th>
        </tr>
      </thead>
      <tbody>
        {record.prizes.map((p, i) => (
          <tr key={i}>
            <th scope="row">{t.places(p.from, p.to)}</th>
            <td>
              {[...p.gifts.map((g) => giftWords(g, catalog)), ...(p.cash ? [euros(p.cash.amountEur)] : [])].join(', ') || t.noGifts}
            </td>
          </tr>
        ))}
        {record.participation ? (
          <tr>
            <th scope="row">{t.fields.participation}</th>
            <td>{record.participation.gifts.map((g) => giftWords(g, catalog)).join(', ')}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
