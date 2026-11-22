import { type AdminTournament, lastPrizePlace, mediaUrl, type TournamentState } from '@galaxy/shared';
import { useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAdminTournaments, useCancelTournament, useDeleteTournament, useTournamentCash, useUnscheduleTournament } from '../../api/admin-tournaments';
import { useLiveContent } from '../../api/content';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { GiftArt } from '../../gifts/GiftArt';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { type GiftCatalog } from '../../gifts/words';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { duration, range } from '../events/shared';
import { CashTable, ConfirmDialog } from './CashTable';
import { anyEntries, euros, feeWords, GROUPS, t, until } from './shared';

// Torneos (plan «temporadas como fichas», part 5; GDD §13.3): every tournament by its state — the ones that need an
// admin first — each with its banner, dates, measure, entrants and prizes, and what can be done to it: a draft is
// edited, copied, scheduled from the wizard's review or deleted; a scheduled one is taken back while nobody is in it, or
// cancelled (every fee back); a running or reviewed one opens its review panel. Above them, the money still to pay.

type Action = { kind: 'remove' | 'unschedule' | 'cancel'; tournament: AdminTournament };

function ActionDialog({ action, onClose }: { action: Action; onClose: (done?: string) => void }) {
  const ids = useId();
  const remove = useDeleteTournament();
  const unschedule = useUnscheduleTournament();
  const cancel = useCancelTournament();
  const [reason, setReason] = useState('');
  const x = action.tournament;
  const title = x.record.title;
  if (action.kind === 'remove') {
    return (
      <Dialog title={t.removeTitle(title)} role="alertdialog" className="admin-dialog" onClose={() => onClose()}>
        <p>{t.removeText}</p>
        <form
          className="admin-publish"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) remove.mutate({ id: x.id, reason: reason.trim() }, { onSuccess: () => onClose(t.done.removed(title)) });
          }}
        >
          <div className="field">
            <label htmlFor={`${ids}-r`}>{copy.admin.fields.reason}</label>
            <div className="control">
              <input id={`${ids}-r`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {remove.error ? <p className="field-error">{errorText(remove.error, copy.errors)}</p> : null}
          <button type="submit" className="lip pill danger" disabled={reason.trim().length < 3 || remove.isPending}>
            <Icon name="trash" />
            <span>{t.actions.remove}</span>
          </button>
        </form>
      </Dialog>
    );
  }
  if (action.kind === 'unschedule') {
    return (
      <ConfirmDialog
        title={t.unscheduleTitle(title)}
        label={t.actions.unschedule}
        busy={unschedule.isPending}
        error={unschedule.error}
        onClose={() => onClose()}
        onConfirm={(r, password) => unschedule.mutate({ id: x.id, reason: r, password }, { onSuccess: () => onClose(t.done.unscheduled(title)) })}
      >
        <p>{t.unscheduleText}</p>
      </ConfirmDialog>
    );
  }
  const paid = x.entrants + x.left;
  return (
    <ConfirmDialog
      title={t.cancelTitle(title)}
      label={t.cancelButton}
      busy={cancel.isPending}
      error={cancel.error}
      onClose={() => onClose()}
      onConfirm={(r, password) => cancel.mutate({ id: x.id, reason: r, password }, { onSuccess: (res) => onClose(t.done.cancelled(title, res.refunded)) })}
    >
      <p>{t.cancelText}</p>
      <p className="panel-note">{x.record.entry ? t.cancelRefund(feeWords(x.record.entry), paid) : t.cancelFree}</p>
    </ConfirmDialog>
  );
}

/** «Puntos de temporada», with its filters after it: sector, probe, kind of run. */
function MetricFact({ x, names }: { x: AdminTournament; names: { sectors: Map<string, string>; probes: Map<string, string> } }) {
  const f = x.record.filters;
  const extra = [f.sector ? (names.sectors.get(f.sector) ?? f.sector) : null, f.probe ? (names.probes.get(f.probe) ?? f.probe) : null, f.mode !== 'any' ? t.modes[f.mode] : null].filter(Boolean);
  return (
    <dd>
      <span>{t.metrics[x.record.metric].name}</span>
      {extra.length ? <small>{extra.join(', ')}</small> : null}
    </dd>
  );
}

function PrizesFact({ x, catalog }: { x: AdminTournament; catalog: GiftCatalog | null }) {
  const r = x.record;
  const first = r.prizes[0];
  if (!first && !r.participation) return <dd>{t.noPrizes}</dd>;
  return (
    <dd>
      {first ? <span>{t.rangesSummary(r.prizes.length, lastPrizePlace(r.prizes))}</span> : null}
      {first && catalog && first.gifts.length ? (
        <ul className="gift-pack-strip tn-strip" aria-hidden="true">
          {first.gifts.slice(0, 6).map((g, i) => (
            <li key={i}>
              <GiftArt gift={g} catalog={catalog} compact />
            </li>
          ))}
        </ul>
      ) : null}
      {r.prizes.some((p) => p.cash) ? (
        <small className="tn-money">
          {t.withCash} <b>{euros(r.prizes.reduce((s, p) => s + (p.cash ? p.cash.amountEur * (p.to - p.from + 1) : 0), 0))}</b>
        </small>
      ) : null}
      {r.participation ? <small>{t.withParticipation}</small> : null}
    </dd>
  );
}

function TournamentCard({ x, now, catalog, names, onAction }: { x: AdminTournament; now: number; catalog: GiftCatalog | null; names: { sectors: Map<string, string>; probes: Map<string, string> }; onAction: (a: Action) => void }) {
  const ids = useId();
  const r = x.record;
  const banner = r.bannerMedia ? mediaUrl(r.bannerMedia) : null;
  const state = x.state;
  const countdown =
    state === 'scheduled' ? t.startsIn(until(r.startsAt, now)) : state === 'running' ? t.endsIn(until(r.endsAt, now)) : state === 'review' ? t.resultsIn(until(new Date(Date.parse(r.endsAt) + r.reviewHours * 3_600_000).toISOString(), now)) : null;
  const warnings = [
    ...(x.simChanged ? [t.simChanged] : []),
    ...(state === 'draft' && x.bigReasons.length ? [t.needsSuperadmin] : []),
    ...(x.pending ? [t.pendingChecks(x.pending)] : []),
    ...(x.undecided ? [t.undecidedChecks(x.undecided)] : []),
    ...(x.cashPending ? [t.cashToPay(x.cashPending)] : []),
  ];
  const canUnschedule = state === 'scheduled' && Date.parse(r.startsAt) > now && !anyEntries(x);
  return (
    <li className={`lip panel ev-card tn-list-card${state === 'finished' || state === 'cancelled' ? ' past' : ''}`} aria-labelledby={`${ids}-h`}>
      <header>
        <span className="tn-thumb" aria-hidden="true">
          {banner ? <img src={banner} alt="" loading="lazy" draggable={false} /> : <Icon name="trophy" />}
        </span>
        <div>
          <h3 id={`${ids}-h`}>{r.title}</h3>
          <p>{r.summary || `/torneos/${r.slug}`}</p>
        </div>
        <span className="tn-chip" data-state={state}>
          {t.states[state]}
        </span>
      </header>
      <dl className="ev-facts">
        <div>
          <dt>{t.facts.when}</dt>
          <dd>
            <span>{range(r.startsAt, r.endsAt)}</span>
            <small>{countdown ?? duration(r.startsAt, r.endsAt)}</small>
          </dd>
        </div>
        <div>
          <dt>{t.facts.metric}</dt>
          <MetricFact x={x} names={names} />
        </div>
        <div>
          <dt>{t.facts.entrants}</dt>
          <dd>
            <span>
              {t.entrants(x.entrants, r.maxEntrants)}
              {r.exclusive ? <span className="admin-chip staff">{t.exclusiveMark}</span> : null}
            </span>
            {x.left || x.disqualified ? <small>{[x.left ? t.left(x.left) : null, x.disqualified ? t.disqualifiedCount(x.disqualified) : null].filter(Boolean).join(', ')}</small> : null}
            <small>{r.entry ? `${t.facts.entry} ${feeWords(r.entry)}` : t.free}</small>
          </dd>
        </div>
        <div>
          <dt>{t.facts.prizes}</dt>
          <PrizesFact x={x} catalog={catalog} />
        </div>
      </dl>
      {warnings.length ? (
        <ul className="ev-warnings">
          {warnings.map((w) => (
            <li key={w}>
              <Icon name="alert" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ev-actions">
        {state === 'draft' ? (
          <>
            <Link to={`/admin/torneos/${x.id}`} className="lip pill small">
              <Icon name="wrench" />
              <span>{t.actions.edit}</span>
            </Link>
            <Link to={`/admin/torneos/${x.id}?paso=revision`} className="lip pill small pill-solar">
              <Icon name="play" />
              <span>{t.actions.schedule}</span>
            </Link>
          </>
        ) : state === 'scheduled' ? (
          <Link to={`/admin/torneos/${x.id}`} className="lip pill small">
            <Icon name="eye" />
            <span>{t.actions.view}</span>
          </Link>
        ) : state === 'running' || state === 'review' ? (
          <Link to={`/admin/torneos/${x.id}`} className={`lip pill small${state === 'review' ? ' pill-solar' : ''}`}>
            <Icon name="shield" />
            <span>{t.actions.review}</span>
          </Link>
        ) : (
          <Link to={`/admin/torneos/${x.id}`} className="lip pill small">
            <Icon name={state === 'finished' ? 'podium' : 'eye'} />
            <span>{state === 'finished' ? t.actions.results : t.actions.view}</span>
          </Link>
        )}
        <Link to={`/admin/torneos/nuevo?desde=${x.id}`} className="lip pill small">
          <Icon name="copy" />
          <span>{t.actions.duplicate}</span>
        </Link>
        {canUnschedule ? (
          <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => onAction({ kind: 'unschedule', tournament: x })}>
            <Icon name="pause" />
            <span>{t.actions.unschedule}</span>
          </button>
        ) : null}
        {state === 'scheduled' || state === 'running' || state === 'review' ? (
          <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => onAction({ kind: 'cancel', tournament: x })}>
            <Icon name="close" />
            <span>{t.actions.cancel}</span>
          </button>
        ) : null}
        {state === 'draft' ? (
          <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => onAction({ kind: 'remove', tournament: x })}>
            <Icon name="trash" />
            <span>{t.actions.remove}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** The live content's sector and probe names, for the cards' filters. */
function useContentNames() {
  const content = useLiveContent();
  return useMemo(() => ({ sectors: new Map(content.sectors.map((s) => [s.id, s.name])), probes: new Map(content.probes.map((p) => [p.id, p.name])) }), [content]);
}

export function TournamentsScreen() {
  const list = useAdminTournaments();
  const cash = useTournamentCash();
  const { catalog } = useGiftCatalog();
  const names = useContentNames();
  const { state } = useLocation() as { state: { done?: string } | null };
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(state?.done ?? null);
  const all = list.data?.tournaments ?? [];
  const now = list.data ? Date.parse(list.data.now) : 0;
  const unpaid = (cash.data?.cash ?? []).filter((c) => !c.paidAt);
  const order = (s: TournamentState) => (a: AdminTournament, b: AdminTournament) => (s === 'finished' || s === 'cancelled' ? Date.parse(b.record.startsAt) - Date.parse(a.record.startsAt) : Date.parse(a.record.startsAt) - Date.parse(b.record.startsAt));
  return (
    <section className="admin-page tn-page">
      <div className="ev-top">
        <div>
          <h1>{copy.admin.sections.tournaments}</h1>
          <p className="panel-note">{t.lead}</p>
        </div>
        <Link to="/admin/torneos/nuevo" className="lip pill pill-solar">
          <Icon name="plus" />
          <span>{t.create}</span>
        </Link>
      </div>
      {done ? (
        <p className="admin-done" role="status">
          {done}
        </p>
      ) : null}
      {list.error ? <p className="field-error">{errorText(list.error, copy.errors)}</p> : null}
      {cash.data && cash.data.cash.length > 0 ? (
        <section className={`lip panel tn-cash${unpaid.length ? ' due' : ''}`} aria-label={t.cash.title}>
          <header className="tn-section-head">
            <Icon name="coin" />
            <h2>{t.cash.title}</h2>
            {unpaid.length ? <span className="admin-chip warn">{unpaid.length}</span> : null}
          </header>
          <p className="panel-note">{t.cash.lead}</p>
          <CashTable cash={cash.data.cash} onDone={setDone} />
        </section>
      ) : null}
      {list.data && all.length === 0 ? (
        <div className="lip panel ev-empty">
          <Icon name="trophy" />
          <p>{t.empty}</p>
        </div>
      ) : null}
      {GROUPS.map((group) => {
        const here = all.filter((x) => x.state === group).sort(order(group));
        if (!here.length) return null;
        return (
          <section key={group} className="ev-group" aria-label={t.groups[group]}>
            <h2>
              {t.groups[group]} <span className="admin-chip">{here.length}</span>
            </h2>
            <ul>
              {here.map((x) => (
                <TournamentCard key={x.id} x={x} now={now} catalog={catalog} names={names} onAction={setAction} />
              ))}
            </ul>
          </section>
        );
      })}
      {action ? (
        <ActionDialog
          action={action}
          onClose={(text) => {
            setAction(null);
            if (text) setDone(text);
          }}
        />
      ) : null}
    </section>
  );
}
