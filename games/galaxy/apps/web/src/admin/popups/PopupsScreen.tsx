import { type AdminPopup, mediaUrl, POPUP_MAX_SHOWS, POPUPS_PER_DAY, type PopupState } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAdminPopups } from '../../api/admin-popups';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import type { GiftCatalog } from '../../gifts/words';
import { Icon } from '../../ui/Icon';
import { duration } from '../events/shared';
import { GiftLine } from '../GiftsField';
import { until } from '../tournaments/shared';
import { type PopupAction, PopupActionDialog } from './PopupActions';
import { audienceWords, canUnpublish, dates, GROUPS, KIND_ICON, t } from './shared';

// «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5): every campaign by its state — the ones players see now
// first — each with its kind in its colour, its dates (Madrid time), who sees it, how many answered of those who saw it
// and its reward, and what can be done to it: a draft is edited, published from the wizard's review, copied or deleted;
// a scheduled one is seen as players will, taken back to draft while nobody saw it, or ended; a live or ended one opens
// its results.

/** «Encuesta» with its icon, in its colour. */
export function KindChip({ kind }: { kind: AdminPopup['record']['kind'] }) {
  return (
    <span className="apop-kind" data-kind={kind}>
      <Icon name={KIND_ICON[kind]} />
      {t.kinds[kind]}
    </span>
  );
}

export function StateChip({ state }: { state: PopupState }) {
  return (
    <span className="apop-state" data-state={state}>
      {t.states[state]}
    </span>
  );
}

/** «12 respuestas de 40 vistas», or a promotion's «Ver más». */
export const answersText = (x: Pick<AdminPopup, 'record' | 'counts'>) =>
  x.counts.seen === 0 ? t.notSeen : x.record.kind === 'promotion' ? t.clicks(x.counts.clicked, x.counts.seen) : t.answers(x.counts.answered, x.counts.seen);

function PopupCard({ x, now, catalog, onAction }: { x: AdminPopup; now: number; catalog: GiftCatalog | null; onAction: (a: PopupAction) => void }) {
  const ids = useId();
  const r = x.record;
  const state = x.state;
  const countdown = state === 'scheduled' ? t.startsIn(until(r.startsAt, now)) : state === 'live' ? t.endsIn(until(r.endsAt, now)) : state === 'ended' && x.endedAt ? t.endedEarly : duration(r.startsAt, r.endsAt);
  const warnings = state === 'draft' && x.bigReasons.length ? [t.needsSuperadmin] : [];
  const who = audienceWords(r.audience);
  return (
    <li className={`lip panel ev-card apop-card${state === 'ended' ? ' past' : ''}`} data-kind={r.kind} aria-labelledby={`${ids}-h`}>
      <header>
        <span className="apop-thumb" data-kind={r.kind} aria-hidden="true">
          {r.imageMedia ? <img src={mediaUrl(r.imageMedia)} alt="" loading="lazy" draggable={false} /> : <Icon name={KIND_ICON[r.kind]} />}
        </span>
        <div>
          <h3 id={`${ids}-h`}>{r.title}</h3>
          {r.body || r.questions[0]?.prompt ? <p>{r.body || r.questions[0]?.prompt}</p> : null}
        </div>
        <span className="apop-chips">
          <KindChip kind={r.kind} />
          <StateChip state={state} />
        </span>
      </header>
      <dl className="ev-facts">
        <div>
          <dt>{t.facts.when}</dt>
          <dd>
            <span>{dates(r.startsAt, r.endsAt)}</span>
            <small>{countdown}</small>
          </dd>
        </div>
        <div>
          <dt>{t.facts.audience}</dt>
          <dd>
            <span>{who.text}</span>
            {who.detail ? <small>{who.detail}</small> : null}
            <small>{t.priorityOf(t.priorities[r.priority] ?? '')}</small>
          </dd>
        </div>
        <div>
          <dt>{t.facts.answers}</dt>
          <dd>
            <span>{answersText(x)}</span>
            {r.kind !== 'promotion' ? <small>{t.questionsCount(r.questions.length)}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{t.facts.reward}</dt>
          <dd>{r.reward.length && catalog ? <GiftLine gifts={r.reward.slice(0, 3)} catalog={catalog} /> : <span>{t.noReward}</span>}</dd>
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
            <Link to={`/admin/encuestas/${x.id}`} className="lip pill small">
              <Icon name="wrench" />
              <span>{t.actions.edit}</span>
            </Link>
            <Link to={`/admin/encuestas/${x.id}?paso=revision`} className="lip pill small pill-solar">
              <Icon name="play" />
              <span>{t.actions.publish}</span>
            </Link>
          </>
        ) : state === 'scheduled' ? (
          <Link to={`/admin/encuestas/${x.id}`} className="lip pill small">
            <Icon name="eye" />
            <span>{t.actions.view}</span>
          </Link>
        ) : (
          <Link to={`/admin/encuestas/${x.id}/resultados`} className={`lip pill small${state === 'live' ? ' pill-solar' : ''}`}>
            <Icon name="podium" />
            <span>{t.actions.results}</span>
          </Link>
        )}
        <Link to={`/admin/encuestas/nueva?desde=${x.id}`} className="lip pill small">
          <Icon name="copy" />
          <span>{t.actions.duplicate}</span>
        </Link>
        {canUnpublish(x, now) ? (
          <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => onAction({ kind: 'unpublish', popup: x })}>
            <Icon name="pause" />
            <span>{t.actions.unpublish}</span>
          </button>
        ) : null}
        {state === 'scheduled' || state === 'live' ? (
          <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => onAction({ kind: 'end', popup: x })}>
            <Icon name="close" />
            <span>{t.actions.end}</span>
          </button>
        ) : null}
        {state === 'draft' ? (
          <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => onAction({ kind: 'remove', popup: x })}>
            <Icon name="trash" />
            <span>{t.actions.remove}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function PopupsScreen() {
  const list = useAdminPopups();
  const { catalog } = useGiftCatalog();
  const { state } = useLocation() as { state: { done?: string } | null };
  const [action, setAction] = useState<PopupAction | null>(null);
  const [done, setDone] = useState<string | null>(state?.done ?? null);
  const all = list.data?.popups ?? [];
  const now = list.data ? Date.parse(list.data.now) : 0;
  // Live and scheduled by what comes first; drafts and ended ones, the newest first.
  const order = (s: PopupState) => (a: AdminPopup, b: AdminPopup) =>
    s === 'live' ? Date.parse(a.record.endsAt) - Date.parse(b.record.endsAt) : s === 'scheduled' ? Date.parse(a.record.startsAt) - Date.parse(b.record.startsAt) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  return (
    <section className="admin-page apop-page">
      <div className="ev-top">
        <div>
          <h1>{copy.admin.sections.popups}</h1>
          <p className="panel-note">{t.lead}</p>
          <p className="panel-note apop-rhythm">{t.rhythm(POPUPS_PER_DAY, POPUP_MAX_SHOWS)}</p>
        </div>
        <Link to="/admin/encuestas/nueva" className="lip pill pill-solar">
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
      {list.data && all.length === 0 ? (
        <div className="lip panel ev-empty">
          <Icon name="megaphone" />
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
                <PopupCard key={x.id} x={x} now={now} catalog={catalog} onAction={setAction} />
              ))}
            </ul>
          </section>
        );
      })}
      {action ? (
        <PopupActionDialog
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
