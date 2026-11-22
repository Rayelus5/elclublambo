import { type AdminTournamentCheck, type AdminTournamentReview, mediaUrl, type TournamentDecideManyResult, type UnverifiableReason } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useDecideCheck, useDecideMany, useDisqualify, usePublishTournament, useTournamentReview } from '../../api/admin-tournaments';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { giftWords } from '../../gifts/words';
import { Icon } from '../../ui/Icon';
import { HScroll } from '../../ui/HScroll';
import { range } from '../events/shared';
import { PublishFields } from '../PublishFields';
import { CashTable, ConfirmDialog } from './CashTable';
import { euros, scoreText, t, when } from './shared';

// A tournament's review panel (plan «temporadas como fichas», part 5, «Panel de revisión»): its ranking (live while it
// runs, frozen once it ends, final once published) with who cannot win prizes and what each place takes; the server's
// replays of the prize places' solo runs, with «Aceptar» or «Descartar» for those it could not check (one by one, or in
// bulk by reason or by player); disqualifying and taking back; and «Publicar ya», which only works when nothing is
// pending. Every change asks for a reason and the password and is audited by the server.

const p = t.panel;
type Ask =
  | { kind: 'decide'; check: AdminTournamentCheck; decision: 'accept' | 'discard' }
  | { kind: 'bulk'; decision: 'accept' | 'discard'; filter: { reason?: UnverifiableReason; username?: string }; count: number; label: string }
  | { kind: 'disqualify'; username: string; disqualified: boolean };

/** A check that waits for an admin (it could not be checked, or the replay failed, and nobody decided). */
const waiting = (c: AdminTournamentCheck) => (c.status === 'unverifiable' || c.status === 'error') && c.decision === null;
const reasonOf = (c: AdminTournamentCheck) => (typeof c.detail?.reason === 'string' ? c.detail.reason : '');
const reasonText = (code: string) => p.reasons[code] ?? (code || p.statuses.unverifiable);

function Detail({ c }: { c: AdminTournamentCheck }) {
  if (c.status === 'unverifiable' || (c.status === 'error' && c.detail?.reason)) return <span>{reasonText(reasonOf(c))}</span>;
  const rows = (c.detail?.rows ?? []).filter((r) => !r.same);
  if (c.status === 'mismatch')
    return (
      <span className="atn-detail">
        {rows.map((r) => (
          <span key={r.key}>{p.detailRow(copy.admin.runs.checkKeys[r.key] ?? r.key, String(r.saved ?? '—'), String(r.replayed))}</span>
        ))}
        <small>{p.mismatchNote}</small>
      </span>
    );
  return <span>—</span>;
}

function BulkGroups({ view, onAsk }: { view: AdminTournamentReview; onAsk: (a: Ask) => void }) {
  // Only groups worth a bulk decision (a single run is decided in the table).
  const byReason = view.unverifiable.byReason.filter((g) => g.count > 1);
  const byPlayer = view.unverifiable.byPlayer.filter((g) => g.count > 1);
  if (byReason.length === 0 && byPlayer.length === 0) return null;
  const row = (label: string, n: number, blocking: number, filter: { reason?: UnverifiableReason; username?: string }) => (
    <li key={`${filter.reason ?? ''}:${filter.username ?? ''}`} className="atn-bulk-row">
      <span className="atn-bulk-what">
        <b>{label}</b> <span className="admin-chip warn">{n}</span>
        {blocking > 0 ? <small>{p.holding(blocking)}</small> : null}
      </span>
      <span className="atn-bulk-actions">
        <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={p.acceptAllOf(label, n)} onClick={() => onAsk({ kind: 'bulk', decision: 'accept', filter, count: n, label })}>
          {p.acceptAll(n)}
        </button>
        <button type="button" className="lip pill small danger" aria-haspopup="dialog" aria-label={p.discardAllOf(label, n)} onClick={() => onAsk({ kind: 'bulk', decision: 'discard', filter, count: n, label })}>
          {p.discardAll(n)}
        </button>
      </span>
    </li>
  );
  return (
    <div className="atn-bulk">
      <h3>{p.bulkTitle}</h3>
      <p className="cf-hint">{p.bulkLead}</p>
      <div className="atn-bulk-cols">
        {byReason.length ? (
          <div>
            <h4>{p.byReason}</h4>
            <ul>{byReason.map((g) => row(reasonText(g.reason), g.count, g.blocking, { reason: g.reason }))}</ul>
          </div>
        ) : null}
        {byPlayer.length ? (
          <div>
            <h4>{p.byPlayer}</h4>
            <ul>{byPlayer.map((g) => row(g.username, g.count, g.blocking, { username: g.username }))}</ul>
          </div>
        ) : null}
      </div>
      {view.checks.some((c) => (c.status === 'error' || c.status === 'mismatch') && c.decision === null) ? <p className="cf-hint">{p.bulkOneByOne}</p> : null}
    </div>
  );
}

function AskDialog({ id, ask, onClose }: { id: string; ask: Ask; onClose: (done?: string) => void }) {
  const decide = useDecideCheck();
  const many = useDecideMany();
  const dq = useDisqualify();
  if (ask.kind === 'decide') {
    const u = ask.check.username;
    const accept = ask.decision === 'accept';
    return (
      <ConfirmDialog
        title={accept ? p.acceptTitle(u) : p.discardTitle(u)}
        label={accept ? p.accept : p.discard}
        busy={decide.isPending}
        error={decide.error}
        onClose={() => onClose()}
        onConfirm={(reason, password) => decide.mutate({ id, run: ask.check.runId, decision: ask.decision, reason, password }, { onSuccess: () => onClose(t.done.decided) })}
      >
        <p>{accept ? p.acceptText : p.discardText}</p>
      </ConfirmDialog>
    );
  }
  if (ask.kind === 'bulk') {
    const accept = ask.decision === 'accept';
    const scope = ask.filter.reason !== undefined ? p.bulkScopeReason(ask.label) : p.bulkScopePlayer(ask.label);
    return (
      <ConfirmDialog
        title={accept ? p.bulkAcceptTitle(ask.count) : p.bulkDiscardTitle(ask.count)}
        label={accept ? p.acceptAll(ask.count) : p.discardAll(ask.count)}
        busy={many.isPending}
        error={many.error}
        onClose={() => onClose()}
        onConfirm={(reason, password) =>
          many.mutate(
            { id, decision: ask.decision, filter: ask.filter, reason, password },
            {
              onSuccess: (r: TournamentDecideManyResult) => onClose([p.bulkDone(r.decided), ...(r.skipped.length > 0 ? [p.bulkSkipped(r.skipped.length)] : [])].join('. ')),
            },
          )
        }
      >
        <p>{accept ? p.bulkAcceptText(ask.count, scope) : p.bulkDiscardText(ask.count, scope)}</p>
      </ConfirmDialog>
    );
  }
  const out = ask.disqualified;
  return (
    <ConfirmDialog
      title={out ? p.disqualifyTitle(ask.username) : p.requalifyTitle(ask.username)}
      label={out ? p.disqualify : p.requalify}
      busy={dq.isPending}
      error={dq.error}
      onClose={() => onClose()}
      onConfirm={(reason, password) => dq.mutate({ id, username: ask.username, disqualified: out, reason, password }, { onSuccess: () => onClose(out ? t.done.disqualified(ask.username) : t.done.requalified(ask.username)) })}
    >
      <p>{out ? p.disqualifyText : p.requalifyText}</p>
    </ConfirmDialog>
  );
}

function Ranking({ view, live, onAsk, catalog }: { view: AdminTournamentReview; live: boolean; onAsk: (a: Ask) => void; catalog: ReturnType<typeof useGiftCatalog>['catalog'] }) {
  const x = view.tournament;
  const metric = x.record.metric;
  const state = x.state;
  return (
    <section className="lip panel atn-section" aria-label={p.rankingTitle}>
      <header className="atn-section-head">
        <Icon name="podium" />
        <h2>{p.rankingTitle}</h2>
        <span className={`admin-chip${state === 'running' ? ' ok' : state === 'review' ? ' warn' : ''}`}>{state === 'running' ? p.live : state === 'review' ? p.frozen : p.final}</span>
      </header>
      {view.ranking.length === 0 ? (
        <p className="panel-note">{p.noRanking}</p>
      ) : (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table atn-ranking">
            <thead>
              <tr>
                <th scope="col">{p.cols.rank}</th>
                <th scope="col">{p.cols.player}</th>
                <th scope="col">{p.cols.score}</th>
                <th scope="col">{p.cols.runs}</th>
                <th scope="col">{p.cols.prize}</th>
                {live ? <th scope="col">{p.cols.actions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {view.ranking.map((r) => (
                <tr key={r.username} className={r.rank <= 3 ? `atn-top atn-top-${r.rank}` : undefined}>
                  <td className="atn-rank">{r.rank}</td>
                  <td>
                    <Link to={`/admin/jugadores/${encodeURIComponent(r.username)}`}>{r.username}</Link>
                    {!r.eligible ? (
                      <span className="admin-chip warn" title={p.notEligibleHint}>
                        {p.notEligible}
                      </span>
                    ) : null}
                  </td>
                  <td className="atn-score">{scoreText(metric, r.score)}</td>
                  <td>{r.runs}</td>
                  <td>
                    {r.rewards ? (
                      <span className="atn-prize-cell">
                        {r.rewards.place !== null ? <span className="admin-chip ok">{p.place(r.rewards.place)}</span> : r.rewards.participation ? <span className="admin-chip">{p.participationOnly}</span> : null}
                        {catalog && r.rewards.gifts.length ? <span className="atn-prize-words">{r.rewards.gifts.map((g) => giftWords(g, catalog)).join(', ')}</span> : null}
                        {r.rewards.cash ? <b className="atn-money">{euros(r.rewards.cash.amountEur)}</b> : null}
                      </span>
                    ) : (
                      <span className="atn-gifts-none">{p.noPrize}</span>
                    )}
                  </td>
                  {live ? (
                    <td>
                      <button type="button" className="lip pill small danger" aria-haspopup="dialog" aria-label={p.disqualifyOf(r.username)} onClick={() => onAsk({ kind: 'disqualify', username: r.username, disqualified: true })}>
                        {p.disqualify}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      )}
    </section>
  );
}

function Checks({ view, onAsk }: { view: AdminTournamentReview; onAsk: (a: Ask) => void }) {
  const inReview = view.tournament.state === 'review';
  return (
    <section className="lip panel atn-section" aria-label={p.checksTitle}>
      <header className="atn-section-head">
        <Icon name="shield" />
        <h2>{p.checksTitle}</h2>
        <span className="admin-chip">{view.checks.length}</span>
      </header>
      <p className="panel-note">{p.checksLead}</p>
      {inReview ? <BulkGroups view={view} onAsk={onAsk} /> : null}
      {view.checks.length === 0 ? (
        <p className="panel-note">{p.checksEmpty}</p>
      ) : (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table atn-checks">
            <thead>
              <tr>
                <th scope="col">{p.checkCols.run}</th>
                <th scope="col">{p.checkCols.player}</th>
                <th scope="col">{p.checkCols.finished}</th>
                <th scope="col">{p.checkCols.status}</th>
                <th scope="col">{p.checkCols.detail}</th>
                <th scope="col">{p.checkCols.decision}</th>
              </tr>
            </thead>
            <tbody>
              {view.checks.map((c) => (
                <tr key={c.runId} className={!c.current && inReview ? 'atn-stale' : waiting(c) ? 'atn-waiting' : undefined}>
                  <td>
                    <Link to={`/admin/partidas/${c.runId}`} aria-label={p.openRun(c.username)}>
                      <code>{c.runId.slice(0, 8)}</code>
                    </Link>
                  </td>
                  <td>{c.username}</td>
                  <td>{c.finishedAt ? when(c.finishedAt) : '—'}</td>
                  <td>
                    <span className="atn-check" data-status={c.status}>
                      {p.statuses[c.status]}
                    </span>
                  </td>
                  <td>
                    <Detail c={c} />
                    {!c.current && inReview ? <small className="atn-stale-note">{p.notCurrent}</small> : null}
                    {c.attempts > 1 ? <small className="atn-stale-note">{p.attempts(c.attempts)}</small> : null}
                  </td>
                  <td>
                    {c.decision ? (
                      <span>{p.decided(c.decision, c.decidedBy)}</span>
                    ) : waiting(c) && inReview ? (
                      <span className="atn-decide">
                        <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={p.acceptOf(c.username)} onClick={() => onAsk({ kind: 'decide', check: c, decision: 'accept' })}>
                          {p.accept}
                        </button>
                        <button type="button" className="lip pill small danger" aria-haspopup="dialog" aria-label={p.discardOf(c.username)} onClick={() => onAsk({ kind: 'decide', check: c, decision: 'discard' })}>
                          {p.discard}
                        </button>
                      </span>
                    ) : waiting(c) ? (
                      <span>{p.waiting}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      )}
    </section>
  );
}

export function ReviewPanel({ id }: { id: string }) {
  const review = useTournamentReview(id);
  const { catalog } = useGiftCatalog();
  const publish = usePublishTournament();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const view = review.data;
  const back = (
    <Link to="/admin/torneos" className="lip pill small">
      <Icon name="back" />
      <span>{copy.admin.sections.tournaments}</span>
    </Link>
  );
  if (!view)
    return (
      <section className="admin-page atn-page">
        {back}
        {review.error ? <p className="field-error">{errorText(review.error, copy.errors)}</p> : null}
      </section>
    );
  const x = view.tournament;
  const r = x.record;
  const state = x.state;
  const live = state === 'running' || state === 'review';
  const blocking = view.blocking;
  const late = state === 'review' && now >= Date.parse(view.publishAt) && blocking > 0;
  const phase =
    state === 'running' ? p.running(when(r.endsAt)) : state === 'review' ? (late ? p.reviewLate(blocking) : p.review(when(view.publishAt))) : state === 'finished' ? p.finished(x.publishedAt ? when(x.publishedAt) : '—') : p.cancelled;
  const simChanged = x.simChanged;
  return (
    <section className="admin-page atn-page">
      {back}
      <header className="atn-head">
        <span className="atn-thumb big" aria-hidden="true">
          {r.bannerMedia ? <img src={mediaUrl(r.bannerMedia)} alt="" draggable={false} /> : <Icon name="trophy" />}
        </span>
        <div>
          <h1>{r.title}</h1>
          <p className="atn-head-facts">
            <span>{range(r.startsAt, r.endsAt)}</span>
            <span>{t.metrics[r.metric].name}</span>
          </p>
        </div>
        <span className="atn-chip" data-state={state}>
          {t.states[state]}
        </span>
      </header>
      {simChanged ? (
        <p className="ev-warnings atn-sim" role="status">
          <Icon name="alert" />
          <span>
            {t.simChanged}
            {x.simVersions.length ? <small>{p.simVersions(x.simVersions.join(', '))}</small> : null}
          </span>
        </p>
      ) : null}
      <p className={`atn-phase${late ? ' late' : ''}`}>{phase}</p>
      {done ? (
        <p className="admin-done" role="status">
          {done}
        </p>
      ) : null}
      <ul className="atn-tiles">
        <li>
          <b>{x.entrants}</b>
          <span>{p.tiles.entrants}</span>
        </li>
        <li className={x.pending ? 'warn' : undefined}>
          <b>{x.pending}</b>
          <span>{p.tiles.pending}</span>
        </li>
        <li className={x.undecided ? 'bad' : undefined}>
          <b>{x.undecided}</b>
          <span>{p.tiles.undecided}</span>
        </li>
        <li className={x.cashPending ? 'warn' : undefined}>
          <b>{x.cashPending}</b>
          <span>{p.tiles.cash}</span>
        </li>
      </ul>
      <div className={`atn-review${live ? '' : ' wide'}`}>
        <div className="atn-review-main">
          <Ranking view={view} live={live} onAsk={setAsk} catalog={catalog} />
          <Checks view={view} onAsk={setAsk} />
          <section className="lip panel atn-section" aria-label={p.disqualifiedTitle}>
            <header className="atn-section-head">
              <Icon name="close" />
              <h2>{p.disqualifiedTitle}</h2>
              <span className="admin-chip">{view.disqualified.length}</span>
            </header>
            {view.disqualified.length === 0 ? (
              <p className="panel-note">{p.noDisqualified}</p>
            ) : (
              <ul className="atn-out">
                {view.disqualified.map((d) => (
                  <li key={d.username}>
                    <b>{d.username}</b>
                    <span>{d.reason ?? p.noReason}</span>
                    {live ? (
                      <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={p.requalifyOf(d.username)} onClick={() => setAsk({ kind: 'disqualify', username: d.username, disqualified: false })}>
                        {p.requalify}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {view.cash.length ? (
            <section className="lip panel atn-section" aria-label={p.cashTitle}>
              <header className="atn-section-head">
                <Icon name="coin" />
                <h2>{p.cashTitle}</h2>
              </header>
              <p className="panel-note">{t.cash.lead}</p>
              <CashTable cash={view.cash} showTournament={false} onDone={setDone} />
            </section>
          ) : null}
        </div>
        {live ? (
          <aside className="lip panel cf-aside atn-publish">
            <section aria-label={p.publishNow}>
              <h2>{p.publishNow}</h2>
              <p className="panel-note">{p.publishHint}</p>
              {state === 'running' ? <p className="cf-hint">{p.publishAfter}</p> : null}
              {state === 'review' && !view.canPublish ? (
                <p className="atn-blocked">
                  <Icon name="lock" />
                  <span>{p.publishBlocked(blocking)}</span>
                </p>
              ) : null}
              <PublishFields
                busy={publish.isPending}
                disabled={!view.canPublish}
                error={publish.error}
                label={p.publishNow}
                onPublish={(reason, password) => publish.mutate({ id, reason, password }, { onSuccess: () => setDone(t.done.published) })}
              />
            </section>
          </aside>
        ) : null}
      </div>
      {ask ? (
        <AskDialog
          id={id}
          ask={ask}
          onClose={(text) => {
            setAsk(null);
            if (text) setDone(text);
          }}
        />
      ) : null}
    </section>
  );
}
