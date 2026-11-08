import { type AdminAlertRow, type AdminListingRow, type AdminTradeRow, type GalaxyLineage, LISTING_STATUSES, TIERS, TRADE_STATUSES } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAdminAlerts, useAdminDeals, useDealLineage } from '../api/admin-market';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useSettled } from '../ui/useSettled';
import { ActionDialog } from './ActionDialog';
import { Pager } from './DataTable';

const t = copy.admin.market;
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(iso));

type Kind = 'listings' | 'trades';
type Open = { action: 'cancel' | 'revert'; kind: Kind; id: string; title: string } | null;

/** One line per galaxy: where it goes back, or why it cannot (in words, never only a colour). */
function lineageLine(g: GalaxyLineage): string {
  if (g.returnable) return t.goesBack(g.galaxy.name, g.to, g.from);
  const move = g.laterMoves[0];
  if (g.fusedInto) return `${g.galaxy.name}: ${t.fused(g.fusedInto.galaxy.name, g.fusedInto.owner)}`;
  if (g.gone) return `${g.galaxy.name}: ${t.gone}`;
  if (move) return `${g.galaxy.name}: ${t.moved(move.from, move.to, day(move.at))}`;
  return `${g.galaxy.name}: ${t.notWith(g.owner ?? '—')}`;
}

/** Reverting a deal: first where each galaxy is now; the button stays off (and says why) when one cannot go back. */
function RevertDialog({ open, onDone, onClose }: { open: NonNullable<Open>; onDone: () => void; onClose: () => void }) {
  const kind = open.kind === 'listings' ? 'listing' : 'trade';
  const lineage = useDealLineage(kind, open.id);
  const data = lineage.data;
  const intro = (
    <div className="deal-lineage" aria-live="polite">
      <p className="deal-lineage-title">{t.lineageTitle}</p>
      {lineage.error ? (
        <p className="field-error" role="alert">
          {errorText(lineage.error, copy.errors)}
        </p>
      ) : !data ? (
        <p className="panel-note">{t.loadingLineage}</p>
      ) : (
        <>
          <ul>
            {data.galaxies.map((g) => (
              <li key={g.galaxy.id} className={g.returnable ? 'ok' : 'no'}>
                {lineageLine(g)}
              </li>
            ))}
          </ul>
          {data.returnable ? (kind === 'listing' ? <p className="panel-note">{t.refundNote}</p> : null) : <p className="deal-blocked">{t.blocked}</p>}
        </>
      )}
    </div>
  );
  return (
    <ActionDialog
      url={`/admin/market/${open.kind}/${open.id}/revert`}
      title={open.title}
      submit={t.revert}
      intro={intro}
      blocked={!data?.returnable}
      password={() => true}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

function StatusCell({ status, reverted }: { status: string; reverted: boolean }) {
  return (
    <td>
      <span className={`admin-chip${status === 'sold' || status === 'done' ? ' ok' : status === 'active' || status === 'open' ? ' staff' : ''}`}>{t.statuses[status]}</span>
      {reverted ? <span className="admin-chip warn">{t.reverted}</span> : null}
    </td>
  );
}

const galaxyCell = (g: { name: string; tier: number } | null) => <td className={g ? `deal-galaxy tier-${TIERS[g.tier]}` : undefined}>{g ? g.name : '—'}</td>;

/**
 * Comercio (DESIGN_SYSTEM §8 novodecies): the history of listings or of trades, filtered by account and status from
 * the address (so going back keeps them), 50 a page; an active one is cancelled, a sale or a done trade reverted.
 */
export function Commerce() {
  const ids = useId();
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tipo') === 'trueques' ? 'trades' : 'listings';
  const status = params.get('estado') ?? '';
  const page = Math.max(1, Number(params.get('pagina') ?? '1') || 1);
  const [account, setAccount] = useState(params.get('cuenta') ?? '');
  const user = useSettled((params.get('cuenta') ?? '').trim(), 300);
  const deals = useAdminDeals({ kind, user: user || undefined, status: status || undefined, page });
  const [open, setOpen] = useState<Open>(null);
  const [done, setDone] = useState(false);
  const change = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };
  const start = (o: NonNullable<Open>) => {
    setDone(false);
    setOpen(o);
  };
  const statuses = kind === 'listings' ? LISTING_STATUSES : TRADE_STATUSES;
  const data = deals.data?.kind === kind ? deals.data : undefined;
  return (
    <div className="mod-pane">
      <div className="mod-toolbar">
        <div className="deal-kinds" role="group" aria-label={t.kinds.listings + ' o ' + t.kinds.trades}>
          {(['listings', 'trades'] as const).map((k) => (
            <button key={k} type="button" className="lip pill small" aria-pressed={kind === k} onClick={() => change({ tipo: k === 'trades' ? 'trueques' : null, estado: null, pagina: null })}>
              {t.kinds[k]}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor={`${ids}-account`}>{t.account}</label>
          <div className="control">
            <input
              id={`${ids}-account`}
              type="search"
              value={account}
              maxLength={20}
              autoComplete="off"
              onChange={(e) => {
                setAccount(e.target.value);
                change({ cuenta: e.target.value.trim() || null, pagina: null });
              }}
            />
          </div>
          <p className="hint">{t.accountHint}</p>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-status`}>{t.status}</label>
          <div className="control">
            <select id={`${ids}-status`} value={status} onChange={(e) => change({ estado: e.target.value || null, pagina: null })}>
              <option value="">{t.all}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {t.statuses[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      {deals.error ? (
        <p className="field-error" role="alert">
          {errorText(deals.error, copy.errors)}
        </p>
      ) : null}
      {data && data.rows.length === 0 ? <p className="panel-note">{kind === 'listings' ? t.noListings : t.noTrades}</p> : null}
      {data && data.rows.length > 0 ? (
        <div className="admin-table-wrap">
          {data.kind === 'listings' ? <ListingsTable rows={data.rows} onAction={start} /> : <TradesTable rows={data.rows} onAction={start} />}
        </div>
      ) : null}
      {data ? <Pager page={data.page} pages={data.pages} onPage={(p) => change({ pagina: p > 1 ? String(p) : null })} /> : null}
      {open?.action === 'cancel' ? (
        <ActionDialog
          url={`/admin/market/${open.kind}/${open.id}/cancel`}
          title={open.title}
          submit={open.kind === 'listings' ? t.withdraw : t.annul}
          password={() => false}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.action === 'revert' ? (
        <RevertDialog
          open={open}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function ListingsTable({ rows, onAction }: { rows: AdminListingRow[]; onAction: (o: NonNullable<Open>) => void }) {
  return (
    <table className="admin-table">
      <caption>{t.listingsTitle}</caption>
      <thead>
        <tr>
          {(['at', 'galaxy', 'seller', 'buyer', 'price', 'status', 'actions'] as const).map((c) => (
            <th key={c} scope="col">
              {t.cols[c]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <time dateTime={r.soldAt ?? r.listedAt}>{when(r.soldAt ?? r.listedAt)}</time>
            </td>
            {galaxyCell(r.galaxy)}
            <td>{r.seller}</td>
            <td>{r.buyer ?? '—'}</td>
            <td>{r.price}</td>
            <StatusCell status={r.status} reverted={!!r.reversal} />
            <td>
              <div className="admin-row-actions">
                {r.status === 'active' ? (
                  <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.withdrawOf(r.galaxy.name)} onClick={() => onAction({ action: 'cancel', kind: 'listings', id: r.id, title: t.withdrawOf(r.galaxy.name) })}>
                    {t.withdraw}
                  </button>
                ) : null}
                {r.status === 'sold' && !r.reversal ? (
                  <button type="button" className="lip pill small danger" aria-haspopup="dialog" aria-label={t.revertOf(r.galaxy.name)} onClick={() => onAction({ action: 'revert', kind: 'listings', id: r.id, title: t.revertOf(r.galaxy.name) })}>
                    {t.revert}
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradesTable({ rows, onAction }: { rows: AdminTradeRow[]; onAction: (o: NonNullable<Open>) => void }) {
  return (
    <table className="admin-table">
      <caption>{t.tradesTitle}</caption>
      <thead>
        <tr>
          {(['at', 'a', 'aGives', 'b', 'bGives', 'status', 'actions'] as const).map((c) => (
            <th key={c} scope="col">
              {t.cols[c]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <time dateTime={r.closedAt ?? r.createdAt}>{when(r.closedAt ?? r.createdAt)}</time>
            </td>
            <td>{r.a}</td>
            {galaxyCell(r.aGalaxy)}
            <td>{r.b}</td>
            {galaxyCell(r.bGalaxy)}
            <StatusCell status={r.status} reverted={!!r.reversal} />
            <td>
              <div className="admin-row-actions">
                {r.status === 'open' ? (
                  <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.annulOf(r.a, r.b)} onClick={() => onAction({ action: 'cancel', kind: 'trades', id: r.id, title: t.annulOf(r.a, r.b) })}>
                    {t.annul}
                  </button>
                ) : null}
                {r.status === 'done' && !r.reversal ? (
                  <button type="button" className="lip pill small danger" aria-haspopup="dialog" aria-label={t.revertTradeOf(r.a, r.b)} onClick={() => onAction({ action: 'revert', kind: 'trades', id: r.id, title: t.revertTradeOf(r.a, r.b) })}>
                    {t.revert}
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function alertDetail(a: AdminAlertRow): string {
  const d = a.details as { ip?: string; price?: number; floor?: number; tierGap?: number };
  if (d.ip) return t.ip(d.ip);
  if (d.price !== undefined && d.floor !== undefined) return t.price(d.price, d.floor);
  if (d.tierGap !== undefined) return t.tierGap(d.tierGap);
  return '—';
}

/** Alertas: the suspicious sales and trades, pending ones first; each is marked reviewed with a reason. */
export function Alerts() {
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(1);
  const alerts = useAdminAlerts(reviewed, page);
  const [open, setOpen] = useState<AdminAlertRow | null>(null);
  const [done, setDone] = useState(false);
  const rows = alerts.data?.rows ?? [];
  return (
    <div className="mod-pane">
      <div className="deal-kinds" role="group" aria-label={t.alertsTitle}>
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            className="lip pill small"
            aria-pressed={reviewed === v}
            onClick={() => {
              setReviewed(v);
              setPage(1);
            }}
          >
            {v ? t.reviewedTab : t.pendingTab}
          </button>
        ))}
      </div>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      {alerts.error ? (
        <p className="field-error" role="alert">
          {errorText(alerts.error, copy.errors)}
        </p>
      ) : null}
      {alerts.data && rows.length === 0 ? <p className="panel-note">{reviewed ? t.noReviewed : t.noAlerts}</p> : null}
      {rows.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>{t.alertsTitle}</caption>
            <thead>
              <tr>
                {(['at', 'kind', 'accounts', 'detail', 'deal', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.alertCols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <time dateTime={a.at}>{when(a.at)}</time>
                  </td>
                  <td>{t.kindsAlert[a.kind]}</td>
                  <td>{t.between(a.seller ?? '—', a.buyer ?? '—')}</td>
                  <td>{alertDetail(a)}</td>
                  <td>
                    {a.deal && a.seller ? (
                      <Link to={`/admin/moderacion/comercio?tipo=${a.deal.kind === 'listing' ? 'anuncios' : 'trueques'}&cuenta=${encodeURIComponent(a.seller)}`}>{t.seeDeal}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {a.review ? (
                      <span>{t.reviewedBy(a.review.by ?? '—', a.review.reason)}</span>
                    ) : (
                      <button
                        type="button"
                        className="lip pill small"
                        aria-haspopup="dialog"
                        onClick={() => {
                          setDone(false);
                          setOpen(a);
                        }}
                      >
                        {t.review}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {alerts.data ? <Pager page={alerts.data.page} pages={alerts.data.pages} onPage={setPage} /> : null}
      {open ? (
        <ActionDialog
          url={`/admin/market/alerts/${open.id}/review`}
          title={t.review}
          submit={t.review}
          password={() => false}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
