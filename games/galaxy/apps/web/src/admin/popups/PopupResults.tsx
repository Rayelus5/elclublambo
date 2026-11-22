import { type AdminPopup, POPUP_MAX_SHOWS, type PopupBucket, type PopupNps, type PopupQuestion, type PopupQuestionSummary, type PopupTotals } from '@galaxy/shared';
import { type CSSProperties, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { popupCsvUrl, usePopupResults, usePopupTexts } from '../../api/admin-popups';
import { useLiveContent } from '../../api/content';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { Icon } from '../../ui/Icon';
import { artUrl } from '../content/art';
import { type PopupAction, PopupActionDialog } from './PopupActions';
import { PopupFacts } from './PopupWizard';
import { KindChip, StateChip } from './PopupsScreen';
import { subjectView, t, when } from './shared';

// The results of a campaign of «Encuestas y avisos» (plan 2026-11-22, part A; DESIGN_SYSTEM §8 quinquagies ter): what
// players did (saw it, answered, «Más tarde», will not see it again, rewards paid; a promotion's closes and «Ver más»)
// in tiles, and each question summed up in hand-made bars like the statistics' (one colour, the width through React's
// style, the number written beside each bar, and a table for screen readers): a scale's or the stars' every value with
// its average, a 0–10 scale's NPS as three labelled stretches, a 1–5 scale's and the stars' share of 4 and 5, a choice's
// share of each option, and a text's answers with who wrote each, 50 at a time. «Exportar CSV» downloads every answer.

const pct = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const num = new Intl.NumberFormat('es-ES');
/** «64 %». */
const percent = (x: number) => `${pct.format(x)} %`;

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  );
}

function Tiles({ popup, totals }: { popup: AdminPopup; totals: PopupTotals }) {
  const x = totals;
  const share = (n: number) => (x.seen > 0 ? percent((n * 100) / x.seen) : '—');
  if (popup.record.kind === 'promotion')
    return (
      <div className="stat-tiles apop-tiles">
        <Tile label={t.tiles.seen} value={num.format(x.seen)} detail={t.tileDetails.seen} />
        <Tile label={t.tiles.closed} value={num.format(x.closed)} detail={t.tileDetails.closed} />
        <Tile label={t.tiles.clicked} value={num.format(x.clicked)} detail={`${share(x.clicked)} ${t.tileDetails.clicked.toLowerCase()}`} />
      </div>
    );
  return (
    <div className="stat-tiles apop-tiles">
      <Tile label={t.tiles.seen} value={num.format(x.seen)} detail={t.tileDetails.seen} />
      <Tile label={t.tiles.answered} value={num.format(x.answered)} />
      <Tile label={t.tiles.rate} value={share(x.answered)} detail={t.tileDetails.rate} />
      <Tile label={t.tiles.later} value={num.format(x.later)} detail={t.tileDetails.later} />
      <Tile label={t.tiles.exhausted} value={num.format(x.exhausted)} detail={t.tileDetails.exhausted(POPUP_MAX_SHOWS)} />
      {popup.record.reward.length > 0 ? <Tile label={t.tiles.rewarded} value={num.format(x.rewarded)} detail={t.tileDetails.rewarded(x.answered)} /> : null}
    </div>
  );
}

/** One row of bars: its name, the bar (scaled to the biggest) and its count and share written beside it. */
interface BarRow {
  key: string;
  label: string;
  count: number;
  pct: number;
}

/** Bars by hand, one colour, the numbers written; a table says the same to screen readers. */
function Bars({ rows, caption, wide = false }: { rows: readonly BarRow[]; caption: string; wide?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <>
      <ul className={`apop-bars${wide ? ' wide' : ''}`} aria-hidden="true">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="apop-bar-label">{r.label}</span>
            <span className="apop-bar">{r.count > 0 ? <i style={{ inlineSize: `${(r.pct / max) * 100}%` }} /> : null}</span>
            <span className="apop-bar-num">
              <b>{num.format(r.count)}</b>
              <small>{percent(r.pct)}</small>
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.cols.value}</th>
            <th scope="col">{t.cols.count}</th>
            <th scope="col">{t.cols.pct}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{num.format(r.count)}</td>
              <td>{percent(r.pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const NPS_GROUPS = ['detractors', 'passives', 'promoters'] as const;

/** The NPS: its score, and the three groups as stretches of one bar, each named with its count and share. */
function Nps({ nps, n }: { nps: PopupNps; n: number }) {
  const ids = useId();
  return (
    <div className="apop-nps">
      <p className="apop-nps-score">
        <b>{signed.format(Math.round(nps.score))}</b>
        <span>
          {t.nps}
          <small>{t.npsHint}</small>
        </span>
      </p>
      <div className="apop-nps-bar" role="img" aria-labelledby={`${ids}-l`}>
        {NPS_GROUPS.map((g) => (nps[g] > 0 ? <i key={g} data-group={g} style={{ flexGrow: nps[g] } as CSSProperties} /> : null))}
      </div>
      <ul id={`${ids}-l`} className="apop-nps-legend" aria-label={t.npsBar}>
        {NPS_GROUPS.map((g) => (
          <li key={g} data-group={g}>
            <i aria-hidden="true" />
            <span>
              <b>{t.npsGroups[g]}</b> <small>{t.npsRanges[g]}</small>
            </span>
            <span className="apop-bar-num">
              <b>{num.format(nps[g])}</b>
              <small>{percent(n > 0 ? (nps[g] * 100) / n : 0)}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A score's name in the bars: «3», or «4 estrellas». */
const scoreLabel = (type: 'scale' | 'stars', b: PopupBucket) => (type === 'stars' ? copy.popups.stars(b.value) : String(b.value));

function QuestionResult({ id, q, s, i, total }: { id: string; q: PopupQuestion; s: PopupQuestionSummary; i: number; total: number }) {
  const content = useLiveContent();
  const ids = useId();
  const subject = q.type === 'scale' && q.subject ? subjectView(q.subject, content) : null;
  const thumb = subject ? artUrl(subject.sprite, 2) : null;
  return (
    <section className="lip panel stats-section apop-result" aria-labelledby={`${ids}-h`}>
      <header className="apop-result-head">
        <p className="apop-result-kicker">
          <span>{t.questionOf(i + 1, total)}</span>
          <span>{q.type === 'scale' ? `${t.q.types.scale} ${t.q.ranges[q.range].toLowerCase()}` : t.q.types[q.type]}</span>
        </p>
        <h2 id={`${ids}-h`}>{q.prompt}</h2>
        {subject ? (
          <span className="apop-result-subject">
            {thumb ? <img src={thumb} alt="" width={32} height={32} /> : null}
            <span>
              {copy.popups.subject[subject.kind]} <b>{subject.name}</b>
            </span>
          </span>
        ) : null}
        <span className="admin-chip">{t.respondents(s.n)}</span>
      </header>
      {s.type === 'text' ? (
        <Texts id={id} question={q.id} />
      ) : s.n === 0 ? (
        <p className="panel-note apop-none">{t.noAnswers}</p>
      ) : s.type === 'choice' ? (
        <>
          <Bars rows={s.options.map((o) => ({ key: o.id, label: o.label, count: o.count, pct: o.pct }))} caption={q.prompt} wide />
          {s.multi ? <p className="stats-sub">{t.multiNote}</p> : null}
        </>
      ) : (
        <div className="apop-scores">
          <div>
            <Bars rows={s.buckets.map((b) => ({ key: String(b.value), label: scoreLabel(s.type, b), count: b.count, pct: b.pct }))} caption={q.prompt} />
          </div>
          <div className="apop-summary">
            <p className="apop-figure">
              <b>{s.average === null ? '—' : one.format(s.average)}</b>
              <span>{t.average}</span>
            </p>
            {s.type === 'scale' && s.nps ? <Nps nps={s.nps} n={s.n} /> : null}
            {s.topBox !== null ? (
              <p className="apop-figure">
                <b>{percent(s.topBox)}</b>
                <span>{t.topBox}</span>
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/** A text question's answers, newest first, with who wrote each (linked to their page); «Cargar más» reads 50 more. */
function Texts({ id, question }: { id: string; question: string }) {
  const q = usePopupTexts(id, question);
  const pages = q.data?.pages ?? [];
  const texts = pages.flatMap((p) => p.texts);
  const total = pages[0]?.total ?? 0;
  if (q.error) return <p className="field-error">{errorText(q.error, copy.errors)}</p>;
  if (q.data && texts.length === 0) return <p className="panel-note apop-none">{t.textsEmpty}</p>;
  return (
    <div className="apop-texts">
      <ol>
        {texts.map((x, i) => (
          <li key={`${x.username}:${x.at}:${i}`}>
            <p className="apop-text-head">
              <Link to={`/admin/jugadores/${encodeURIComponent(x.username)}`}>{x.username}</Link>
              <time dateTime={x.at}>{when(x.at)}</time>
            </p>
            <p className="apop-text-body">{x.text}</p>
          </li>
        ))}
      </ol>
      {q.data ? (
        <div className="apop-texts-foot">
          <span className="cf-hint">{t.textsShown(texts.length, total)}</span>
          {q.hasNextPage ? (
            <button type="button" className="lip pill small" disabled={q.isFetchingNextPage} aria-busy={q.isFetchingNextPage || undefined} onClick={() => void q.fetchNextPage()}>
              <Icon name="down" />
              <span>{t.textsMore}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PopupResults() {
  const { id = '' } = useParams();
  const res = usePopupResults(id);
  const { catalog } = useGiftCatalog();
  const [action, setAction] = useState<PopupAction | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const data = res.data;
  const popup = data?.popup;
  const r = popup?.record;
  return (
    <section className="admin-page apop-page apop-results">
      <Link to="/admin/encuestas" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.sections.popups}</span>
      </Link>
      {done ? (
        <p className="admin-done" role="status">
          {done}
        </p>
      ) : null}
      {res.error ? <p className="field-error">{(res.error as { status?: number }).status === 404 ? t.notFound : errorText(res.error, copy.errors)}</p> : null}
      {popup && r && data ? (
        <>
          <div className="ev-top apop-results-top">
            <div>
              <p className="apop-chips">
                <KindChip kind={r.kind} />
                <StateChip state={popup.state} />
              </p>
              <h1>{r.title}</h1>
              <p className="panel-note">{t.resultsTitle}</p>
            </div>
            <div className="ev-actions">
              <a className="lip pill small pill-solar" href={popupCsvUrl(popup.id)} download>
                <Icon name="install" />
                <span>{t.actions.csv}</span>
              </a>
              <Link to={`/admin/encuestas/nueva?desde=${popup.id}`} className="lip pill small">
                <Icon name="copy" />
                <span>{t.actions.duplicate}</span>
              </Link>
              {popup.state === 'live' || popup.state === 'scheduled' ? (
                <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => setAction({ kind: 'end', popup })}>
                  <Icon name="close" />
                  <span>{t.actions.end}</span>
                </button>
              ) : null}
            </div>
          </div>
          <PopupFacts record={r} catalog={catalog} />
          <Tiles popup={popup} totals={data.totals} />
          {r.kind === 'promotion' ? <p className="panel-note">{t.promotionLead}</p> : null}
          {data.questions.map((s, i) => {
            const q = r.questions.find((x) => x.id === s.id);
            return q ? <QuestionResult key={s.id} id={popup.id} q={q} s={s} i={i} total={data.questions.length} /> : null;
          })}
        </>
      ) : null}
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
