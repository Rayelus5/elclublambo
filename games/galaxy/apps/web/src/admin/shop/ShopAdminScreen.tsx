import { HScroll } from '../../ui/HScroll';
import { type AdminCreatedPrice, SHOP_PURCHASE_STATUSES, type ShopAmounts, type ShopPurchaseStatus } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAdminPost } from '../../api/admin';
import { useShopAlerts, useShopBlocks, useShopPurchases, useShopSummary, useVerifyPrices } from '../../api/admin-shop';
import { errorText } from '../../auth/useMe';
import { copy, fmt } from '../../copy/es';
import { eur } from '../../shop/art-hooks';
import { amountsText } from '../../shop/ProductCard';
import { ActionDialog } from '../ActionDialog';
import { DataTable, Pager } from '../DataTable';

// The resource shop in the panel (shop and lab plan, F5b; DESIGN_SYSTEM §8 sedecies): what it earns and its state,
// every purchase (synced with Stripe when its webhook never came), the alerts to review, the blocked accounts (and
// blocking one), and the Stripe prices of the catalogue checked or made. Changes go through ActionDialog: a reason
// always, and the admin's password for blocking, unblocking and making prices.

const t = copy.admin.shop;
type Tab = 'summary' | 'purchases' | 'alerts' | 'blocks' | 'prices';
const TABS: { tab: Tab; slug: string }[] = [
  { tab: 'summary', slug: 'resumen' },
  { tab: 'purchases', slug: 'compras' },
  { tab: 'alerts', slug: 'avisos' },
  { tab: 'blocks', slug: 'bloqueos' },
  { tab: 'prices', slug: 'precios' },
];
type Dialog = { url: string; title: string; submit: string; password: boolean; intro?: string; result?: boolean } | null;

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
    </div>
  );
}

function Summary() {
  const s = useShopSummary();
  if (!s.data) return s.error ? <p className="field-error" role="alert">{errorText(s.error, copy.errors)}</p> : null;
  const d = s.data;
  return (
    <>
      <p className="panel-note">
        {t.state(d.enabled, d.audience)}. {t.stripe(d.ready ? d.mode : null)}. <Link to="/admin/configuracion/shop">{t.configure}</Link>
      </p>
      <div className="stat-tiles">
        <Tile label={t.tiles.today} value={eur(d.paid.todayCents)} />
        <Tile label={t.tiles.week} value={eur(d.paid.weekCents)} />
        <Tile label={t.tiles.month} value={eur(d.paid.monthCents)} />
        <Tile label={t.tiles.all} value={eur(d.paid.allCents)} />
        <Tile label={t.tiles.count} value={fmt(d.paid.count)} />
        <Tile label={t.tiles.buyers} value={fmt(d.paid.buyers)} />
        <Tile label={t.tiles.refunded} value={eur(d.refundedCents)} />
        <Tile label={t.tiles.disputed} value={fmt(d.disputed)} />
        <Tile label={t.tiles.alerts} value={fmt(d.openAlerts)} />
        <Tile label={t.tiles.blocked} value={fmt(d.blocked)} />
      </div>
      <DataTable caption={t.byProduct} rows={d.products.map((p) => ({ product: p.name, count: fmt(p.count), cents: eur(p.cents) }))} columns={['product', 'count', 'cents']} />
    </>
  );
}

function Purchases() {
  const ids = useId();
  const [status, setStatus] = useState<ShopPurchaseStatus | ''>('');
  const [draft, setDraft] = useState('');
  const [username, setUsername] = useState('');
  const [page, setPage] = useState(1);
  const list = useShopPurchases({ status: status || undefined, username: username || undefined, page });
  const sync = useAdminPost();
  return (
    <>
      <form
        className="admin-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setUsername(draft.trim());
          setPage(1);
        }}
      >
        <label htmlFor={`${ids}-status`}>{copy.admin.cols.status}</label>
        <select id={`${ids}-status`} value={status} onChange={(e) => (setStatus(e.target.value as ShopPurchaseStatus | ''), setPage(1))}>
          <option value="">{t.all}</option>
          {SHOP_PURCHASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.statuses[s]}
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-user`}>{t.account}</label>
        <input id={`${ids}-user`} type="text" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="lip pill small">
          {t.filter}
        </button>
      </form>
      {list.error ? <p className="field-error" role="alert">{errorText(list.error, copy.errors)}</p> : null}
      {sync.error ? <p className="field-error" role="alert">{errorText(sync.error, copy.errors)}</p> : null}
      {list.data ? (
        <>
          <DataTable
            rows={list.data.rows.map((p) => ({
              id: p.id,
              at: p.createdAt,
              username: p.username,
              product: p.name,
              statusLabel: t.statuses[p.status],
              status: p.status,
              amount: eur(p.amountCents),
              refunded: p.refundedCents > 0 ? eur(p.refundedCents) : null,
              first: p.firstBonus,
              detail: amountsText(p.grants as ShopAmounts),
              paid: p.paidAt,
            }))}
            columns={['at', 'username', 'product', 'detail', 'statusLabel', 'amount', 'refunded', 'first', 'paid']}
            action={(r) =>
              ['creating', 'pending', 'expired'].includes(String(r['status'])) ? (
                <button type="button" className="lip pill small" aria-label={t.syncOf(String(r['id']))} disabled={sync.isPending} onClick={() => sync.mutate({ url: `/admin/shop/purchases/${String(r['id'])}/sync`, body: {} })}>
                  {t.sync}
                </button>
              ) : null
            }
          />
          <Pager page={list.data.page} pages={list.data.pages} onPage={setPage} />
        </>
      ) : null}
    </>
  );
}

function detailOf(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof d['refundedCents'] === 'number') parts.push(eur(d['refundedCents']));
  if (d['taken'] && typeof d['taken'] === 'object') {
    const taken = amountsText(d['taken'] as ShopAmounts);
    if (taken) parts.push(t.detail.taken(taken));
  }
  if (d['short'] && typeof d['short'] === 'object') {
    const short = amountsText(d['short'] as ShopAmounts);
    if (short) parts.push(t.detail.short(short));
  }
  if (typeof d['status'] === 'string') parts.push(d['status']);
  if (typeof d['expected'] === 'number') parts.push(t.detail.expected(eur(d['expected'])));
  return parts.join(', ') || JSON.stringify(d);
}

function Alerts({ onOpen }: { onOpen: (d: NonNullable<Dialog>) => void }) {
  const [all, setAll] = useState(false);
  const alerts = useShopAlerts(!all);
  return (
    <>
      <label className="admin-check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        <span>{t.showReviewed}</span>
      </label>
      {alerts.error ? <p className="field-error" role="alert">{errorText(alerts.error, copy.errors)}</p> : null}
      {alerts.data ? (
        <DataTable
          rows={alerts.data.map((a) => ({
            id: a.id,
            at: a.createdAt,
            kindLabel: t.alertKinds[a.kind] ?? a.kind,
            kind: a.kind,
            username: a.username,
            product: a.product,
            detailText: detailOf(a.details),
            by: a.reviewer ? t.reviewed(a.reviewer) : null,
            reviewed: a.reviewedAt !== null,
          }))}
          columns={['at', 'kindLabel', 'username', 'product', 'detailText', 'by']}
          action={(r) =>
            r['reviewed'] ? null : (
              <button type="button" className="lip pill small" onClick={() => onOpen({ url: `/admin/shop/alerts/${String(r['id'])}/review`, title: t.reviewTitle(String(r['kindLabel'])), submit: t.review, password: false })}>
                {t.review}
              </button>
            )
          }
        />
      ) : null}
    </>
  );
}

function Blocks({ onOpen }: { onOpen: (d: NonNullable<Dialog>) => void }) {
  const ids = useId();
  const [who, setWho] = useState('');
  const blocks = useShopBlocks();
  return (
    <>
      <form
        className="admin-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const name = who.trim();
          if (name) onOpen({ url: `/admin/shop/blocks/${encodeURIComponent(name)}/block`, title: t.blockTitle(name), submit: t.block, password: true });
        }}
      >
        <label htmlFor={`${ids}-who`}>{t.blockWho}</label>
        <input id={`${ids}-who`} type="text" value={who} onChange={(e) => setWho(e.target.value)} />
        <button type="submit" className="lip pill small danger" disabled={who.trim() === ''}>
          {t.block}
        </button>
      </form>
      {blocks.error ? <p className="field-error" role="alert">{errorText(blocks.error, copy.errors)}</p> : null}
      {blocks.data ? (
        <DataTable
          rows={blocks.data.map((b) => ({ username: b.username, reason: b.reason, at: b.createdAt, by: b.by }))}
          columns={['username', 'reason', 'at', 'by']}
          action={(r) => (
            <button type="button" className="lip pill small" onClick={() => onOpen({ url: `/admin/shop/blocks/${encodeURIComponent(String(r['username']))}/unblock`, title: t.unblockTitle(String(r['username'])), submit: t.unblock, password: true })}>
              {t.unblock}
            </button>
          )}
        />
      ) : null}
    </>
  );
}

function Prices({ onOpen }: { onOpen: (d: NonNullable<Dialog>) => void }) {
  const verify = useVerifyPrices();
  const checks = verify.data;
  return (
    <>
      <div className="admin-filters">
        <button type="button" className="lip pill small" disabled={verify.isPending} onClick={() => verify.mutate()}>
          {t.verify}
        </button>
        <button type="button" className="lip pill small" onClick={() => onOpen({ url: '/admin/shop/prices/create', title: t.createTitle, submit: t.create, password: true, intro: t.createIntro, result: true })}>
          {t.create}
        </button>
      </div>
      <p className="panel-note">{t.verifyHint}</p>
      {verify.error ? <p className="field-error" role="alert">{errorText(verify.error, copy.errors)}</p> : null}
      {checks ? (
        <>
          {checks.every((c) => c.problem === null) ? <p className="admin-done" role="status">{t.allOk}</p> : null}
          <DataTable
            rows={checks.map((c) => ({
              product: c.name,
              where: t.where[c.where],
              priceId: c.priceId,
              expected: eur(c.expectedCents),
              stripe: c.stripeCents === null ? null : eur(c.stripeCents),
              check: c.problem === null ? t.ok : t.problems[c.problem],
              before: c.beforeCents === null ? null : eur(c.beforeCents),
            }))}
            columns={['product', 'where', 'priceId', 'expected', 'stripe', 'check', 'before']}
          />
        </>
      ) : null}
    </>
  );
}

export function ShopAdminScreen() {
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [done, setDone] = useState(false);
  const tab = TABS.find((x) => x.slug === params.get('pestana'))?.tab ?? 'summary';
  const choose = (next: Tab) => {
    setDone(false);
    setParams({ pestana: TABS.find((x) => x.tab === next)!.slug }, { replace: true });
  };
  return (
    <section className="admin-page shop-admin">
      <h1>{t.title}</h1>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      <HScroll className="tabs admin-tabs" role="tablist" aria-label={t.tabsLabel}>
        {TABS.map((x) => (
          <button key={x.tab} type="button" role="tab" aria-selected={tab === x.tab} onClick={() => choose(x.tab)}>
            {t.tabs[x.tab]}
          </button>
        ))}
      </HScroll>
      <div role="tabpanel" aria-label={t.tabs[tab]}>
        {tab === 'summary' ? <Summary /> : null}
        {tab === 'purchases' ? <Purchases /> : null}
        {tab === 'alerts' ? <Alerts onOpen={setDialog} /> : null}
        {tab === 'blocks' ? <Blocks onOpen={setDialog} /> : null}
        {tab === 'prices' ? <Prices onOpen={setDialog} /> : null}
      </div>
      {dialog ? (
        <ActionDialog
          url={dialog.url}
          title={dialog.title}
          submit={dialog.submit}
          intro={dialog.intro ? <p className="panel-note">{dialog.intro}</p> : undefined}
          password={() => dialog.password}
          result={
            dialog.result
              ? (r) => {
                  const made = r as unknown as AdminCreatedPrice[];
                  return (
                    <>
                      <p className="admin-done" role="status">
                        {t.created}
                      </p>
                      <ul>
                        {made.map((m) => (
                          <li key={`${m.product}-${m.where}`}>
                            {m.product} ({t.where[m.where]}, {eur(m.cents)}): <code>{m.priceId}</code>
                          </li>
                        ))}
                      </ul>
                    </>
                  );
                }
              : undefined
          }
          onDone={() => {
            setDialog(null);
            setDone(true);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
