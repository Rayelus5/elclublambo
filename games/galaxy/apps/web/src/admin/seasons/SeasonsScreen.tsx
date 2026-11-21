import { type AdminSeason, madridDayOf, madridMidnightOf, type SeasonCalendarWarning } from '@galaxy/shared';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAdminSeasons, useDeleteSeason, useExtendSeason, useUnscheduleSeason } from '../../api/seasons';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { PublishFields } from '../PublishFields';

// Temporadas (plan «temporadas como fichas», 2026-11-21): every season on one calendar (the open one, the scheduled,
// the drafts and the past), with what can be done to each. A scheduled season opens on its own at its date and the
// previous one closes on its own with its prizes; the warnings say when some days will have no season.

const t = copy.admin.seasons;
const DAY = 86_400_000;
type Group = 'open' | 'scheduled' | 'draft' | 'closed';
const ORDER: Group[] = ['open', 'scheduled', 'draft', 'closed'];

const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric' });
/** A season's day as Madrid reads it: 23 nov 2026. */
export const madridDate = (iso: string) => dayFmt.format(new Date(iso));
/** The days a season lasts (whole Madrid days). */
export const seasonDays = (s: Pick<AdminSeason, 'startsAt' | 'endsAt'>) => Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / DAY);

/** Where a season goes on the calendar (`now`: the server's, from the list). */
export function groupOf(s: AdminSeason, now: number): Group {
  if (s.state === 'draft' || s.state === 'closed') return s.state;
  return s.open ? 'open' : Date.parse(s.endsAt) <= now ? 'closed' : 'scheduled';
}

export function warningText(w: SeasonCalendarWarning): string {
  return w.kind === 'gap' ? t.gap(madridDate(w.from), madridDate(w.to)) : t.nothingNext(madridDate(w.endsAt));
}

type Action = { kind: 'unschedule' | 'extend' | 'remove'; season: AdminSeason };

function ActionDialog({ action, onClose }: { action: Action; onClose: (done?: string) => void }) {
  const unschedule = useUnscheduleSeason();
  const extend = useExtendSeason();
  const remove = useDeleteSeason();
  const s = action.season;
  const [day, setDay] = useState(() => madridDayOf(s.endsAt));
  const [moveNext, setMoveNext] = useState(true);
  const [reason, setReason] = useState('');
  if (action.kind === 'remove') {
    return (
      <Dialog title={t.removeTitle(s.name)} role="alertdialog" className="admin-dialog" onClose={() => onClose()}>
        <p>{t.removeText}</p>
        <form
          className="admin-publish"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) remove.mutate({ id: s.id, reason: reason.trim() }, { onSuccess: () => onClose(t.done.removed(s.name)) });
          }}
        >
          <div className="field">
            <label htmlFor="season-remove-reason">{t.removeReason}</label>
            <div className="control">
              <input id="season-remove-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
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
      <Dialog title={t.unscheduleTitle(s.name)} role="alertdialog" className="admin-dialog" onClose={() => onClose()}>
        <p>{t.unscheduleText}</p>
        <PublishFields busy={unschedule.isPending} disabled={false} error={unschedule.error} label={t.actions.unschedule} onPublish={(r, password) => unschedule.mutate({ id: s.id, reason: r, password }, { onSuccess: () => onClose(t.done.unscheduled(s.name)) })} />
      </Dialog>
    );
  }
  let endsAt: string | null = null;
  try {
    endsAt = madridMidnightOf(day);
  } catch {
    endsAt = null;
  }
  return (
    <Dialog title={t.extendTitle(s.name)} className="admin-dialog" onClose={() => onClose()}>
      <p>{t.extendText}</p>
      <div className="cf-field">
        <label htmlFor="season-extend-day">{t.extendDay}</label>
        <input id="season-extend-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <label className="ev-toggle">
        <input type="checkbox" checked={moveNext} onChange={(e) => setMoveNext(e.target.checked)} />
        <span>{t.moveNext}</span>
      </label>
      <PublishFields
        busy={extend.isPending}
        disabled={!endsAt}
        error={extend.error}
        label={t.actions.extend}
        onPublish={(r, password) => endsAt && extend.mutate({ id: s.id, endsAt, moveNext, reason: r, password }, { onSuccess: () => onClose(t.done.extended(s.name)) })}
      />
    </Dialog>
  );
}

function SeasonCard({ s, group, now, onAction }: { s: AdminSeason; group: Group; now: number; onAction: (a: Action) => void }) {
  const lastStep = s.route.steps.at(-1)?.at ?? 0;
  return (
    <li className={`lip panel ev-card ${group === 'open' ? 'live' : group === 'closed' ? 'past' : 'next'}`}>
      <header>
        <span className="ev-icon" aria-hidden="true">
          <Icon name="trophy" />
        </span>
        <div>
          <h3>{s.name}</h3>
          <p>{s.id}</p>
        </div>
        <span className={`ev-phase ${group === 'open' ? 'live' : group === 'closed' ? 'past' : 'next'}`}>{t.states[group]}</span>
      </header>
      <dl className="ev-facts">
        <div>
          <dt>{t.when}</dt>
          <dd>
            {madridDate(s.startsAt)} – {madridDate(s.endsAt)} <small>{t.days(seasonDays(s))}</small>
            {group === 'open' ? <small>{t.left(Math.ceil((Date.parse(s.endsAt) - now) / DAY))}</small> : null}
            {group === 'scheduled' ? <small>{t.startsIn(Math.ceil((Date.parse(s.startsAt) - now) / DAY))}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{t.facts.route}</dt>
          <dd>{t.routeSummary(s.route.steps.length, lastStep)}</dd>
        </div>
        <div>
          <dt>{t.facts.shop}</dt>
          <dd>{t.shopSummary(s.route.shop.length)}</dd>
        </div>
        <div>
          <dt>{t.facts.missions}</dt>
          <dd>
            {t.missionsSummary(s.missions.length)} <small>{t.labSummary(s.lab.length)}</small>
          </dd>
        </div>
        <div>
          <dt>{t.facts.anomaly}</dt>
          <dd>{s.rules.anomaly ?? t.none}</dd>
        </div>
      </dl>
      <div className="ev-actions">
        {group === 'draft' ? (
          <Link to={`/admin/temporadas/${s.id}`} className="lip pill small">
            <Icon name="wrench" />
            <span>{t.actions.edit}</span>
          </Link>
        ) : (
          <Link to={`/admin/temporadas/${s.id}`} className="lip pill small">
            <Icon name="eye" />
            <span>{t.actions.view}</span>
          </Link>
        )}
        <Link to={`/admin/temporadas/nueva?desde=${s.id}`} className="lip pill small">
          <Icon name="copy" />
          <span>{t.actions.duplicate}</span>
        </Link>
        {group === 'open' ? (
          <button type="button" className="lip pill small" onClick={() => onAction({ kind: 'extend', season: s })}>
            <Icon name="calendar" />
            <span>{t.actions.extend}</span>
          </button>
        ) : null}
        {group === 'scheduled' ? (
          <button type="button" className="lip pill small" onClick={() => onAction({ kind: 'unschedule', season: s })}>
            <Icon name="pause" />
            <span>{t.actions.unschedule}</span>
          </button>
        ) : null}
        {group === 'draft' ? (
          <button type="button" className="lip pill small danger" onClick={() => onAction({ kind: 'remove', season: s })}>
            <Icon name="trash" />
            <span>{t.actions.remove}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function SeasonsScreen() {
  const list = useAdminSeasons();
  const { state } = useLocation() as { state: { done?: string } | null };
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(state?.done ?? null);
  const seasons = list.data?.seasons ?? [];
  const now = list.data ? Date.parse(list.data.now) : 0;
  const latest = [...seasons].filter((s) => s.state !== 'draft').sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
  return (
    <section className="admin-page">
      <div className="ev-top">
        <div>
          <h1>{copy.admin.sections.seasons}</h1>
          <p className="panel-note">{t.lead}</p>
        </div>
        <Link to={latest ? `/admin/temporadas/nueva?desde=${latest.id}` : '/admin/temporadas/nueva'} className="lip pill pill-solar">
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
      {list.data?.warnings.length ? (
        <ul className="ev-warnings" aria-label={t.issuesTitle}>
          {list.data.warnings.map((w) => (
            <li key={`${w.kind}:${w.after}`}>
              <Icon name="alert" />
              <span>{warningText(w)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {list.data && seasons.length === 0 ? (
        <div className="lip panel ev-empty">
          <Icon name="trophy" />
          <p>{t.empty}</p>
        </div>
      ) : null}
      {ORDER.map((group) => {
        const here = seasons.filter((s) => groupOf(s, now) === group).sort((a, b) => (group === 'closed' ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt)));
        if (!here.length) return null;
        return (
          <section key={group} className="ev-group" aria-label={t.groups[group]}>
            <h2>{t.groups[group]}</h2>
            <ul>
              {here.map((s) => (
                <SeasonCard key={s.id} s={s} group={group} now={now} onAction={setAction} />
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
