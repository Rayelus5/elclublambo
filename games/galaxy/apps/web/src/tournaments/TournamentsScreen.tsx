import { type TournamentCard, tournamentPath } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGacha } from '../api/economy';
import { listOf, useTournaments } from '../api/tournaments';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { usePlayerGiftView } from '../gifts/usePlayerGiftView';
import { WalletBar } from '../hub/WalletBar';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';
import { EntryAction, MyStatus, PrizeStrip, StateChip, TimeChip, TournamentArt, useEntryFlow } from './parts';

// The tournaments (plan «temporadas como fichas», part 5; GDD §13.3; DESIGN_SYSTEM §8 quinquagies): three tabs in
// the address (En curso, Próximos, Terminados, the last also those in review and the cancelled ones), opening on the
// first with something in it. Each card wears its banner, its state, the time to its start or end ticking, how it is
// won, its first prizes, who is in it and my place, and the action: sign up (explained first), leave (asked first) or
// why not. The wallet sits up top, as in Missions, so the fee is read against what you have.

const t = copy.tournaments;
type Tab = 'running' | 'upcoming' | 'finished';
const TABS: Tab[] = ['running', 'upcoming', 'finished'];
const SLUG: Record<Tab, string> = { running: 'en-curso', upcoming: 'proximos', finished: 'terminados' };
const tabOf = (slug: string | null): Tab | null => TABS.find((k) => SLUG[k] === slug) ?? null;

function Tile({ c, catalog, onAsk, busy, i }: { c: TournamentCard; catalog: ReturnType<typeof usePlayerGiftView>; onAsk: (card: TournamentCard, action: 'join' | 'leave') => void; busy: boolean; i: number }) {
  const id = `tn-${c.id}`;
  return (
    <li className="tn-cell" style={{ '--i': i } as CSSProperties}>
      <article className={`lip panel tn-card s-${c.state}${c.me?.status === 'joined' ? ' in' : ''}`} aria-labelledby={id}>
        <div className="tn-card-art">
          <TournamentArt card={c} />
          <span className="tn-card-tags">
            <StateChip state={c.state} />
            {c.exclusive ? (
              <span className="tn-tag" title={t.exclusiveHint}>
                <Icon name="lock" />
                {t.exclusive}
              </span>
            ) : null}
          </span>
        </div>
        <div className="tn-card-body">
          <h2 id={id}>
            <Link to={tournamentPath(c.slug)}>{c.title}</Link>
          </h2>
          {c.summary ? <p className="tn-summary">{c.summary}</p> : null}
          <div className="tn-meta">
            <TimeChip card={c} />
            <span className="tn-chip">
              <Icon name="target" />
              {t.metric[c.metric]}
            </span>
            <span className="tn-chip">
              <Icon name="clan" />
              {t.entrants(c.entrants, c.maxEntrants)}
            </span>
          </div>
          <PrizeStrip prizes={c.prizes} catalog={catalog} />
          <MyStatus card={c} />
          <div className="tn-card-foot">
            <EntryAction card={c} onAsk={onAsk} busy={busy} compact />
            <Link to={tournamentPath(c.slug)} className="lip pill small tn-see" aria-label={t.seeOf(c.title)}>
              <span>{t.see}</span>
              <Icon name="next" />
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}

export function TournamentsScreen() {
  const [params] = useSearchParams();
  const q = useTournaments();
  const gacha = useGacha();
  const catalog = usePlayerGiftView();
  const data = q.data;
  const all = listOf(data);
  const lists: Record<Tab, TournamentCard[]> = { running: data?.running ?? [], upcoming: data?.upcoming ?? [], finished: data?.finished ?? [] };
  // Without a tab in the address, the first with something in it.
  const tab = tabOf(params.get('pestana')) ?? TABS.find((k) => lists[k].length > 0) ?? 'running';
  const flow = useEntryFlow(all);
  const shown = lists[tab];
  return (
    <div className="screen-root tn-root">
      <div className="tn-screen">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
          <div className="lip panel hud missions-wallet tn-wallet" data-wallet>
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>
        <nav className="tabs tn-tabs" aria-label={t.tabsLabel}>
          {TABS.map((k) => (
            <Link key={k} to={`/torneos?pestana=${SLUG[k]}`} aria-current={k === tab ? 'page' : undefined}>
              {t.tabs[k]}
              {data && lists[k].length > 0 ? (
                <span className="tn-tab-count" aria-hidden="true">
                  {lists[k].length}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        {flow.notice}
        {q.error ? (
          <p className="field-error" role="alert">
            {errorText(q.error, copy.errors)}
          </p>
        ) : null}
        {!data ? (
          q.isPending ? (
            <p className="planetarium-wait" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </p>
          ) : null
        ) : shown.length === 0 ? (
          <div className="lip panel tn-empty">
            <Icon name="trophy" />
            <p>{t.empty[tab]}</p>
            {tab !== 'upcoming' && lists.upcoming.length > 0 ? (
              <Link to="/torneos?pestana=proximos" className="lip pill pill-solar">
                <span>{t.seeUpcoming}</span>
                <Icon name="next" />
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="tn-grid" aria-label={t.tabs[tab]}>
            {shown.map((c, i) => (
              <Tile key={c.id} c={c} catalog={catalog} onAsk={flow.ask} busy={flow.busy} i={i} />
            ))}
          </ul>
        )}
      </div>
      {flow.dialogs}
    </div>
  );
}
