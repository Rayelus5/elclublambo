import { REFERRAL_STATES, type ReferralState } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useReferralList } from '../../api/referrals';
import { errorText } from '../../auth/useMe';
import { copy, fmt } from '../../copy/es';
import { HScroll } from '../../ui/HScroll';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { useSettled } from '../../ui/useSettled';
import { ActionDialog } from '../ActionDialog';
import { cellText, Pager } from '../DataTable';
import { browserOf, FlagChip, STATE_URL, StateChip, stateFromUrl } from './parts';

// «Referidos» (plan «referidos», part R2): everyone who came in with a code, 50 a page, the newest first: their code
// and its owner, when, the state (with who reviewed it), the marks that held it (each one explained), the address and
// browser of the sign-up, their level, and which gifts were paid. The state, «solo los marcados», the search and the
// page live in the address. A held one is approved (its gifts are paid) or rejected, always with a reason.

const t = copy.admin.referrals;
type Review = { username: string; decision: 'approve' | 'reject' };

/** «Referidos»: the filters, what each mark means, the page of newcomers and the review of a held one. */
export function NewcomersTab({ params, change }: { params: URLSearchParams; change: (next: Record<string, string | null>) => void }) {
  const ids = useId();
  const [text, setText] = useState(params.get('q') ?? '');
  const state = stateFromUrl(params.get('estado'));
  const flagged = params.get('marcados') === '1';
  const page = Math.max(1, Number(params.get('pagina') ?? '1') || 1);
  const q = useSettled((params.get('q') ?? '').trim().slice(0, 40), 300);
  const list = useReferralList({ state, flagged, q, page });
  const [review, setReview] = useState<Review | null>(null);
  const [done, setDone] = useState(false);
  const data = list.data;
  const filtered = !!state || flagged || !!q;

  return (
    <>
      <div className="mod-toolbar ref-toolbar">
        <div className="field admin-search">
          <label htmlFor={`${ids}-q`}>{t.search}</label>
          <div className="control">
            <input
              id={`${ids}-q`}
              type="search"
              value={text}
              maxLength={40}
              autoComplete="off"
              aria-describedby={`${ids}-q-hint`}
              onChange={(e) => {
                setText(e.target.value);
                change({ q: e.target.value.trim() || null, pagina: null });
              }}
            />
          </div>
          <p id={`${ids}-q-hint`} className="hint">
            {t.listSearchHint}
          </p>
        </div>
        <div className="field ref-state">
          <label htmlFor={`${ids}-state`}>{t.state}</label>
          <div className="control">
            <Select<ReferralState | 'all'>
              id={`${ids}-state`}
              size="lg"
              block
              value={state ?? 'all'}
              options={[{ value: 'all', label: t.all }, ...REFERRAL_STATES.map((s) => ({ value: s, label: t.states[s] }))]}
              onChange={(s) => change({ estado: s === 'all' ? null : STATE_URL[s], pagina: null })}
            />
          </div>
        </div>
        <div className="ref-flagged">
          <Switch checked={flagged} aria-labelledby={`${ids}-flagged`} onChange={(on) => change({ marcados: on ? '1' : null, pagina: null })} />
          <span id={`${ids}-flagged`}>{t.flaggedOnly}</span>
        </div>
        {data ? (
          <p className="panel-note ref-total" aria-live="polite">
            {t.total(data.total)}
          </p>
        ) : null}
      </div>
      <details className="ref-legend">
        <summary>{t.flagsLegend}</summary>
        <dl>
          {(Object.keys(t.flags) as (keyof typeof t.flags)[]).map((f) => (
            <div key={f}>
              <dt>{t.flags[f]}</dt>
              <dd>{t.flagHelp[f]}</dd>
            </div>
          ))}
        </dl>
      </details>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      {list.error ? (
        <p className="field-error" role="alert">
          {errorText(list.error, copy.errors)}
        </p>
      ) : null}
      {data && data.rows.length === 0 ? <p className="panel-note">{filtered ? t.noRowsMatch : t.noRows}</p> : null}
      {data && data.rows.length > 0 ? (
        <>
          <HScroll variant="table" className="admin-table-wrap">
            <table className="admin-table ref-table" aria-label={t.tabs.referrals} aria-busy={list.isFetching || undefined}>
              <thead>
                <tr>
                  {(['newcomer', 'code', 'owner', 'date', 'state', 'flags', 'ip', 'browser', 'level', 'newcomerPaid', 'ownerPaid'] as const).map((c) => (
                    <th key={c} scope="col" className={c === 'newcomerPaid' || c === 'ownerPaid' ? 'ref-th-wrap' : undefined}>
                      {t.cols[c]}
                    </th>
                  ))}
                  <th scope="col">{t.cols.actions}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.username} className={r.state === 'held' ? 'is-held' : undefined}>
                    <th scope="row" className="ref-who">
                      <Link to={`/admin/jugadores/${encodeURIComponent(r.username)}`}>{r.username}</Link>
                    </th>
                    <td>
                      <code className="ref-code">{r.code}</code>
                    </td>
                    <td className="ref-who">
                      <Link to={`/admin/jugadores/${encodeURIComponent(r.owner)}`}>{r.owner}</Link>
                    </td>
                    <td className="ref-when">{cellText('createdAt', r.createdAt)}</td>
                    <td>
                      <span className="ref-state-cell">
                        <StateChip state={r.state} />
                        {r.reviewedBy ? <small>{t.reviewedBy(r.reviewedBy)}</small> : null}
                      </span>
                    </td>
                    <td>
                      {r.flags.length ? (
                        <span className="ref-flags">
                          {r.flags.map((f) => (
                            <FlagChip key={f} flag={f} />
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="ref-ip">{r.ip ?? '—'}</td>
                    <td className="ref-browser" title={r.userAgent ?? undefined}>
                      {browserOf(r.userAgent) ?? '—'}
                    </td>
                    <td className="ref-num">{fmt(r.level)}</td>
                    <td>{cellText('newcomerPaid', r.newcomerPaid)}</td>
                    <td>{cellText('ownerPaid', r.ownerPaid)}</td>
                    <td>
                      {r.state === 'held' ? (
                        <div className="ref-actions">
                          <button type="button" className="lip pill small pill-solar" aria-haspopup="dialog" aria-label={t.approveOf(r.username)} onClick={() => (setDone(false), setReview({ username: r.username, decision: 'approve' }))}>
                            <Icon name="check" />
                            <span>{t.approve}</span>
                          </button>
                          <button type="button" className="row-delete" aria-haspopup="dialog" aria-label={t.rejectOf(r.username)} onClick={() => (setDone(false), setReview({ username: r.username, decision: 'reject' }))}>
                            <Icon name="close" />
                            <span>{t.reject}</span>
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          <Pager page={data.page} pages={data.pages} onPage={(n) => change({ pagina: n > 1 ? String(n) : null })} />
        </>
      ) : null}
      {review ? (
        <ActionDialog
          url={`/admin/referrals/${encodeURIComponent(review.username)}/review`}
          title={review.decision === 'approve' ? t.approveOf(review.username) : t.rejectOf(review.username)}
          submit={review.decision === 'approve' ? t.approve : t.reject}
          intro={<p className="panel-note">{review.decision === 'approve' ? t.approveIntro : t.rejectIntro}</p>}
          password={() => false}
          build={() => ({ decision: review.decision })}
          onDone={() => {
            setReview(null);
            setDone(true);
          }}
          onClose={() => setReview(null)}
        />
      ) : null}
    </>
  );
}
