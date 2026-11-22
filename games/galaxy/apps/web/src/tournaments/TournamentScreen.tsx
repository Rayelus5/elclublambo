import { prizeForPlace, type TournamentDetail, type TournamentMetric, type TournamentRankRow, type TournamentRunRow } from '@galaxy/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useContentNames } from '../api/content-names';
import { useGacha } from '../api/economy';
import { listOf, useClaimTournament, useTournament, useTournaments } from '../api/tournaments';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { GiftTile } from '../gifts/GiftArt';
import { usePlayerGiftView } from '../gifts/usePlayerGiftView';
import { Avatar } from '../hub/Avatar';
import { WalletBar } from '../hub/WalletBar';
import { useClaimFx } from '../missions/ClaimFx';
import { playClaim } from '../missions/sfx';
import { BackLink } from '../ui/BackLink';
import { Celebration } from '../ui/Celebration';
import { Countdown } from '../ui/Countdown';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { CashBadge, EntryAction, MyStatus, StateChip, toCollect, TournamentArt, useEntryFlow } from './parts';
import { dateTime, feeWords, isBest, rewardOf } from './words';

// A tournament's page (plan «temporadas como fichas», part 5; GDD §13.3; DESIGN_SYSTEM §8 quinquagies): the banner
// as its hero with the summary, the state, my status and the action; a panel for the moment it is in (the countdown to
// its start or end, the review in plain words, the final result with my prize and «Recoger», the cancel and its
// refund); the ranking with its podium, its table from the fourth on and my row pinned under it (an account that
// cannot win keeps its place with a mark); my runs that count; and beside them how it is won, in plain words, and its
// prizes by place. Collecting sounds, flies to the wallet up top and is celebrated, as on the season screen.

const t = copy.tournaments;
type View = ReturnType<typeof usePlayerGiftView>;

/** The rule lines of the page, each with its icon, from the tournament's own record (nothing here is written in). */
function ruleLines(d: TournamentDetail, names: ReturnType<typeof useContentNames>): { icon: IconName; text: string }[] {
  const out: { icon: IconName; text: string }[] = [{ icon: 'target', text: t.metricHow[d.metric] }];
  out.push({ icon: 'calendar', text: t.window(dateTime(d.startsAt), dateTime(d.endsAt)) });
  out.push({ icon: 'comet', text: d.metric === 'season_points' ? t.windowSeason : t.windowFromJoin });
  if (d.filters.sector) out.push({ icon: 'compass', text: t.onlySector(names.sectorName(d.filters.sector)) });
  if (d.filters.probe) out.push({ icon: 'probe', text: t.onlyProbe(names.probeName(d.filters.probe)) });
  if (d.filters.mode === 'solo') out.push({ icon: 'play', text: t.onlySolo });
  if (d.filters.mode === 'coop') out.push({ icon: 'clan', text: t.onlyCoop });
  if (d.filters.minLevel !== null) out.push({ icon: 'up', text: t.minLevel(d.filters.minLevel) });
  if (d.maxEntrants !== null) out.push({ icon: 'clan', text: t.cap(d.maxEntrants) });
  if (d.entry) out.push({ icon: 'coin', text: t.feeRule(feeWords(d.entry)) });
  if (d.exclusive) out.push({ icon: 'lock', text: t.exclusiveHint });
  out.push({ icon: 'exit', text: t.leaveRule });
  out.push({ icon: 'shield', text: t.cleanRule });
  out.push({ icon: 'podium', text: t.tie });
  out.push({ icon: 'eye', text: t.reviewRule(d.reviewHours) });
  return out;
}

function Rules({ d }: { d: TournamentDetail }) {
  const names = useContentNames();
  const id = useId();
  return (
    <section className="lip panel tn-rules" aria-labelledby={id}>
      <h2 id={id}>{t.rulesTitle}</h2>
      <ul>
        {ruleLines(d, names).map((l, i) => (
          <li key={i}>
            <Icon name={l.icon} />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      {d.rules ? (
        <div className="tn-rules-more">
          <h3>{t.rulesMore}</h3>
          <p>{d.rules}</p>
        </div>
      ) : null}
    </section>
  );
}

/** The prizes by place (each range's gifts drawn, its money), the participation prize and the prize picture. */
function Prizes({ d, catalog }: { d: TournamentDetail; catalog: View }) {
  const id = useId();
  const mine = d.state === 'finished' ? (d.me?.rewards?.place ?? null) : (d.mine?.place ?? null);
  const hasCash = d.prizes.some((p) => p.cash);
  return (
    <section className="lip panel tn-prizes" aria-labelledby={id}>
      <h2 id={id}>{t.prizesTitle}</h2>
      {d.details ? <img className="tn-details" src={d.details} alt={t.prizesImage} loading="lazy" decoding="async" /> : null}
      {d.prizes.length === 0 ? <p className="tn-no-prizes">{t.noPrizes}</p> : null}
      <ol className="tn-prize-table">
        {d.prizes.map((p) => (
          <li key={p.from} className={`r-${Math.min(p.from, 4)}`} aria-current={mine !== null && prizeForPlace([p], mine) ? 'true' : undefined}>
            <div className="tn-prize-row">
              <span className="tn-place-badge">{t.places(p.from, p.to)}</span>
              {p.gifts.length > 0 ? (
                <ul className="gift-grid-list">
                  {p.gifts.map((g, i) => (
                    <GiftTile key={i} gift={g} catalog={catalog} />
                  ))}
                </ul>
              ) : null}
              {p.cash ? (
                <p className="tn-cash-row">
                  <CashBadge eur={p.cash.amountEur} />
                  {p.cash.note ? <small>{p.cash.note}</small> : null}
                </p>
              ) : null}
            </div>
          </li>
        ))}
        {d.participation ? (
          <li className="r-all">
            <div className="tn-prize-row">
              <span className="tn-place-badge">
                <Icon name="check" />
                {t.participation(d.participation.minRuns)}
              </span>
              <ul className="gift-grid-list">
                {d.participation.gifts.map((g, i) => (
                  <GiftTile key={i} gift={g} catalog={catalog} />
                ))}
              </ul>
            </div>
          </li>
        ) : null}
      </ol>
      {hasCash ? <p className="panel-note">{t.cashNote}</p> : null}
    </section>
  );
}

function NoPrize() {
  return (
    <span className="tn-no-prize" title={t.noPrizeHint}>
      {t.noPrizeMark}
    </span>
  );
}

/** The top three, first in the middle on screen (in order for screen readers), each to its profile. */
function Podium({ rows, metric }: { rows: TournamentRankRow[]; metric: TournamentMetric }) {
  return (
    <ol className="podium large tn-podium" aria-label={copy.social.podium}>
      {rows.slice(0, 3).map((r, i) => (
        <li key={r.username} className={`place-${i + 1}`} aria-current={r.me ? 'true' : undefined}>
          <span className="sr-only">{copy.social.rank(r.rank)}</span>
          <Link to={`/perfil/${encodeURIComponent(r.username)}`} className="podium-who">
            <span className="podium-avatar">
              <Avatar name={r.username} avatar={r.avatar} frame={r.frame} size={i === 0 ? 96 : 72} fit="outer" />
            </span>
            <b>{r.username}</b>
          </Link>
          <span className="podium-value">{t.value[metric](r.score)}</span>
          {r.eligible ? null : <NoPrize />}
          <span className="podium-step" aria-hidden="true">
            {r.rank}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Row({ r, metric }: { r: TournamentRankRow; metric: TournamentMetric }) {
  return (
    <tr aria-current={r.me ? 'true' : undefined} className={r.me ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(r.rank)}</td>
      <th scope="row" className="lb-who">
        <Avatar name={r.username} avatar={r.avatar} frame={r.frame} />
        <Link to={`/perfil/${encodeURIComponent(r.username)}`}>{r.username}</Link>
        {r.me ? <span className="lb-you">{copy.social.you}</span> : null}
        {r.eligible ? null : <NoPrize />}
      </th>
      <td className="tn-prize-cell">
        {r.place !== null ? (
          <span className="tn-prize-mark" role="img" aria-label={t.prizeMark(r.place)} title={t.prizeMark(r.place)}>
            <Icon name="trophy" />
          </span>
        ) : null}
      </td>
      <td className="lb-value">{t.value[metric](r.score)}</td>
    </tr>
  );
}

function Head({ hidden = false }: { hidden?: boolean }) {
  return (
    <thead className={hidden ? 'sr-only' : undefined}>
      <tr>
        <th scope="col">{t.columns.rank}</th>
        <th scope="col">{t.columns.player}</th>
        <th scope="col" className="tn-prize-cell">
          {t.columns.prize}
        </th>
        <th scope="col">{t.columns.score}</th>
      </tr>
    </thead>
  );
}

function Ranking({ d }: { d: TournamentDetail }) {
  const id = useId();
  const mine = d.mine;
  const inTop = mine !== null && d.ranking.some((r) => r.me);
  return (
    <section className="tn-ranking" aria-labelledby={id}>
      <div className="tn-section-head">
        <h2 id={id}>{t.rankingTitle}</h2>
        {d.total > 0 ? <span>{t.players(d.total)}</span> : null}
      </div>
      {d.state === 'scheduled' ? (
        <p className="lip panel tn-empty-line">{t.rankingSoon}</p>
      ) : d.ranking.length === 0 ? (
        <div className="lip panel tn-empty-line">
          <p>{d.state === 'running' ? t.rankingEmpty : t.rankingNone}</p>
          {d.state === 'running' ? (
            <Link to="/incursion" className="lip pill pill-solar small">
              <Icon name="play" />
              <span>{t.play}</span>
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <Podium rows={d.ranking} metric={d.metric} />
          {d.ranking.length > 3 ? (
            <div className="lip panel lb-scroll">
              <table className="lb-table tn-table" aria-label={t.rankingTitle}>
                <Head />
                <tbody>
                  {d.ranking.slice(3).map((r) => (
                    <Row key={r.username} r={r} metric={d.metric} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {mine && !inTop ? (
            <section className="lip panel lb-pinned tn-table" aria-label={t.yourRow}>
              <table>
                <Head hidden />
                <tbody>
                  <Row r={mine} metric={d.metric} />
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function MyRuns({ d }: { d: TournamentDetail }) {
  const id = useId();
  const names = useContentNames();
  const best = isBest(d.metric);
  const top = best ? Math.max(0, ...d.myRuns.map((r) => r.value)) : null;
  const cell = (r: TournamentRunRow) => (best ? t.value[d.metric](r.value) : `+${fmt(r.value)}`);
  return (
    <section className="tn-runs" aria-labelledby={id}>
      <div className="tn-section-head">
        <h2 id={id}>{t.runsTitle}</h2>
      </div>
      {d.myRuns.length === 0 ? (
        <div className="lip panel tn-empty-line">
          <p>{t.runsEmpty}</p>
          {d.state === 'running' ? (
            <Link to="/incursion" className="lip pill pill-solar small">
              <Icon name="play" />
              <span>{t.play}</span>
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="lip panel lb-scroll">
          <table className="lb-table tn-runs-table" aria-label={t.runsTitle}>
            <thead>
              <tr>
                <th scope="col">{t.runsCols.when}</th>
                <th scope="col">{t.runsCols.sector}</th>
                <th scope="col">{t.runsCols.probe}</th>
                <th scope="col">{t.runsCols.mode}</th>
                <th scope="col" className="num">
                  {t.runsCols.depth}
                </th>
                <th scope="col" className="num">
                  {t.runsCols.kills}
                </th>
                <th scope="col" className="num">
                  {t.runsCols.cores}
                </th>
                <th scope="col" className="num">
                  {best ? t.runsCols.best : t.runsCols.value}
                </th>
              </tr>
            </thead>
            <tbody>
              {d.myRuns.map((r) => (
                <tr key={r.id} className={best && r.value === top ? 'best' : undefined}>
                  <td>{when(r.finishedAt)}</td>
                  <td>{names.sectorName(r.sector)}</td>
                  <td>{names.probeName(r.probe)}</td>
                  <td>{r.coop ? t.group : t.solo}</td>
                  <td className="num">{fmt(r.depth)}</td>
                  <td className="num">{fmt(r.kills)}</td>
                  <td className="num">{fmt(r.cores)}</td>
                  <td className="num lb-value">
                    {best && r.value === top ? (
                      <span className="tn-best" title={t.bestRun}>
                        <Icon name="starOn" />
                        <span className="sr-only">{t.bestRun}</span>
                      </span>
                    ) : null}
                    {cell(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The panel of the moment: when it starts or ends, the review, the result with my prize, or the cancel. */
function Moment({ d, catalog, onClaim, claiming }: { d: TournamentDetail; catalog: View; onClaim: () => void; claiming: boolean }) {
  const id = useId();
  const me = d.me;
  if (d.state === 'scheduled' || d.state === 'running') {
    const soon = d.state === 'scheduled';
    return (
      <section className={`lip panel tn-moment s-${d.state}`} aria-labelledby={id}>
        <span className="tn-moment-icon" aria-hidden="true">
          <Icon name={soon ? 'calendar' : 'play'} />
        </span>
        <div className="tn-moment-text">
          <h2 id={id}>{soon ? t.soonTitle : t.runningTitle}</h2>
          <p>{soon ? t.soonHint : t.runningHint}</p>
        </div>
        <Countdown endsAt={soon ? d.startsAt : d.endsAt} className="tn-big-time" label={soon ? t.startsIn : t.endsIn} />
      </section>
    );
  }
  if (d.state === 'review') {
    return (
      <section className="lip panel tn-moment s-review" aria-labelledby={id}>
        <span className="tn-moment-icon" aria-hidden="true">
          <Icon name="shield" />
        </span>
        <div className="tn-moment-text">
          <h2 id={id}>{t.reviewTitle(dateTime(d.resultsAt ?? d.endsAt))}</h2>
          <p>{t.reviewChecking(d.review?.checks ?? 0, d.review?.pending ?? 0)}</p>
        </div>
      </section>
    );
  }
  if (d.state === 'cancelled') {
    return (
      <section className="lip panel tn-moment s-cancelled" aria-labelledby={id}>
        <span className="tn-moment-icon" aria-hidden="true">
          <Icon name="close" />
        </span>
        <div className="tn-moment-text">
          <h2 id={id}>{t.cancelledTitle}</h2>
          <p>{me?.refunded ? t.refunded : d.entry ? t.cancelledFee : t.cancelledNone}</p>
        </div>
      </section>
    );
  }
  // Finished: my result and what it gives.
  const rewards = me?.rewards ?? null;
  const gifts = rewards?.gifts ?? [];
  return (
    <section className={`lip panel tn-moment s-finished${rewards ? ' won' : ''}`} aria-labelledby={id}>
      <span className="tn-moment-icon" aria-hidden="true">
        <Icon name="trophy" />
      </span>
      <div className="tn-moment-text">
        <h2 id={id}>{t.finishedTitle}</h2>
        {d.resultsAt ? <small>{t.finishedOn(dateTime(d.resultsAt))}</small> : null}
        {!me ? (
          <p>{t.notIn}</p>
        ) : me.status === 'disqualified' ? (
          <p>{t.disqualifiedWhy(me.reason)}</p>
        ) : me.rank === null ? (
          <p>{t.noResult}</p>
        ) : (
          <p className="tn-result">{t.yourResult(me.rank, d.total)}</p>
        )}
        {me && !me.eligible ? <p className="tn-ineligible">{t.ineligible}</p> : null}
        {me && me.eligible && me.rank !== null && !rewards ? <p>{t.noPrizeWon}</p> : null}
      </div>
      {rewards ? (
        <div className={`tn-my-prize${me?.claimed ? ' taken' : ''}`}>
          {gifts.length > 0 ? (
            <ul className="gift-grid-list">
              {gifts.map((g, i) => (
                <GiftTile key={i} gift={g} catalog={catalog} />
              ))}
            </ul>
          ) : null}
          {rewards.cash ? (
            <p className="tn-cash-row">
              <CashBadge eur={rewards.cash.amountEur} />
              <small>{t.cashNote}</small>
            </p>
          ) : null}
          {gifts.length > 0 ? (
            me?.claimed ? (
              <>
                {/* The galaxies it gave wait in the collection. */}
                {gifts.some((g) => g.kind === 'galaxy') ? (
                  <Link to="/coleccion" className="lip pill small">
                    <Icon name="cards" />
                    <span>{copy.mail.reveal.toCollection}</span>
                  </Link>
                ) : null}
                <p className="gift-done" role="status">
                  <Icon name="check" />
                  <span>{t.claimed}</span>
                </p>
              </>
            ) : (
              <button type="button" className="lip pill pill-solar tn-claim" data-claim="tournament" disabled={claiming} aria-busy={claiming || undefined} aria-label={t.claimOf(d.title)} onClick={onClaim}>
                <Icon name="trophy" />
                <span>{t.claim}</span>
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function TournamentScreen() {
  const { slug = '' } = useParams();
  const q = useTournament(slug);
  const all = listOf(useTournaments().data);
  const gacha = useGacha();
  const catalog = usePlayerGiftView();
  const claim = useClaimTournament();
  const reduced = useReducedMotion();
  const fx = useClaimFx(reduced);
  const flow = useEntryFlow(all);
  const [big, setBig] = useState<{ key: number; name: string } | null>(null);
  const bigKey = useRef(0);
  useEffect(() => {
    if (!big) return;
    const id = setTimeout(() => setBig(null), 2600);
    return () => clearTimeout(id);
  }, [big]);
  const d = q.data;

  async function collect(): Promise<void> {
    if (!d || !toCollect(d) || claim.isPending) return;
    const gifts = d.me!.rewards!.gifts;
    // The box the button has now: the answer replaces it with «Recogido».
    const from = document.querySelector('[data-claim="tournament"]')?.getBoundingClientRect() ?? null;
    try {
      await claim.mutateAsync(d.id);
    } catch {
      // The mutation shows its own error.
      return;
    }
    const reward = rewardOf(gifts);
    playClaim(reward, true);
    fx.burst(from, reward);
    setBig({ key: ++bigKey.current, name: d.title });
  }

  const error = q.error ?? claim.error;
  return (
    <div className="screen-root tn-root">
      <div className="tn-screen tn-page">
        <header className="collection-bar">
          <BackLink to="/torneos" />
          {/* With the tournament, its title is the hero's. */}
          {d ? null : <h1>{t.title}</h1>}
          <div className="lip panel hud missions-wallet tn-wallet" data-wallet>
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>
        {error ? (
          <p className="field-error" role="alert">
            {errorText(error, copy.errors)}
          </p>
        ) : null}
        {!d ? (
          q.isPending ? (
            <p className="planetarium-wait" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </p>
          ) : null
        ) : (
          <>
            <section className={`lip panel tn-hero s-${d.state}`} aria-label={d.title}>
              <TournamentArt card={d} className="tn-art tn-hero-art" />
              <div className="tn-hero-body">
                <span className="tn-card-tags">
                  <StateChip state={d.state} />
                  {d.exclusive ? (
                    <span className="tn-tag" title={t.exclusiveHint}>
                      <Icon name="lock" />
                      {t.exclusive}
                    </span>
                  ) : null}
                </span>
                <h1 className="tn-hero-title">{d.title}</h1>
                {d.summary ? <p className="tn-hero-summary">{d.summary}</p> : null}
                <div className="tn-meta">
                  <span className="tn-chip">
                    <Icon name="target" />
                    {t.metric[d.metric]}
                  </span>
                  <span className="tn-chip">
                    <Icon name="clan" />
                    {t.entrants(d.entrants, d.maxEntrants)}
                  </span>
                  <span className="tn-chip">
                    <Icon name="coin" />
                    {d.entry ? t.fee(feeWords(d.entry)) : t.free}
                  </span>
                </div>
                <div className="tn-hero-foot">
                  <MyStatus card={d} />
                  <EntryAction card={d} onAsk={flow.ask} busy={flow.busy} onPage />
                </div>
              </div>
            </section>
            {flow.notice}
            <div className="tn-body">
              <div className="tn-main">
                <Moment d={d} catalog={catalog} onClaim={() => void collect()} claiming={claim.isPending} />
                {d.state === 'cancelled' ? null : <Ranking d={d} />}
                {d.me?.status === 'joined' && d.state !== 'scheduled' && d.state !== 'cancelled' ? <MyRuns d={d} /> : null}
              </div>
              <aside className="tn-side">
                <Prizes d={d} catalog={catalog} />
                <Rules d={d} />
              </aside>
            </div>
          </>
        )}
      </div>
      {fx.view}
      {big ? (
        <div className="claim-celebration">
          <Celebration key={big.key} title={t.bigClaim} subtitle={big.name} reduced={reduced} />
        </div>
      ) : null}
      {flow.dialogs}
    </div>
  );
}
