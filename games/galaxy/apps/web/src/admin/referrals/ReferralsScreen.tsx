import { type KeyboardEvent, type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import { useReferralSummary } from '../../api/referrals';
import { errorText } from '../../auth/useMe';
import { copy, fmt } from '../../copy/es';
import { giftsText } from '../../referrals/invite';
import { HScroll } from '../../ui/HScroll';
import { CodesTab } from './CodesTab';
import { NewcomersTab } from './NewcomersTab';
import { STATE_URL, useParamsChange, useReferralsConfig } from './parts';
import { RewardsTab } from './RewardsTab';

// «Referidos» (plan «referidos», part R2; the owner: veterans bring players with a code, and both get a gift). Four
// tabs that live in the address (`?seccion=`, replaced, so «Volver» and a reload keep the place): Resumen, Códigos,
// Referidos and Premios. Admins only (App.tsx puts it under AdminOnly); every change is audited by the server.

const t = copy.admin.referrals;
type Tab = 'summary' | 'codes' | 'referrals' | 'rewards';
const TABS: { tab: Tab; slug: string }[] = [
  { tab: 'summary', slug: 'resumen' },
  { tab: 'codes', slug: 'codigos' },
  { tab: 'referrals', slug: 'referidos' },
  { tab: 'rewards', slug: 'premios' },
];
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });

/** The panel's «Referidos» (`/admin/referidos`), its tab in `?seccion=`. */
export function ReferralsScreen() {
  const ids = useId();
  const [params, change] = useParamsChange();
  const tab = TABS.find((x) => x.slug === params.get('seccion'))?.tab ?? 'summary';
  // A tab starts clean: the filters of another one never come along.
  const choose = (next: Tab) => change({ seccion: TABS.find((x) => x.tab === next)!.slug, q: null, estado: null, marcados: null, pagina: null, dueno: null });
  // WAI-ARIA tabs: the arrows, Home and End move between them (and choose), Tab leaves for the panel.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((x) => x.tab === tab);
    const to = e.key === 'ArrowRight' ? (at + 1) % TABS.length : e.key === 'ArrowLeft' ? (at - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(TABS[to]!.tab);
    document.getElementById(`${ids}-${TABS[to]!.tab}`)?.focus();
  };
  return (
    <section className="admin-page referrals-admin">
      <h1>{copy.admin.sections.referrals}</h1>
      <p className="stats-sub">{t.intro}</p>
      <HScroll className="tabs admin-tabs" role="tablist" aria-label={t.tabsLabel} onKeyDown={onKey}>
        {TABS.map((x) => (
          <button
            key={x.tab}
            id={`${ids}-${x.tab}`}
            type="button"
            role="tab"
            aria-selected={tab === x.tab}
            aria-controls={`${ids}-panel`}
            tabIndex={tab === x.tab ? 0 : -1}
            onClick={() => choose(x.tab)}
          >
            {t.tabs[x.tab]}
          </button>
        ))}
      </HScroll>
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-${tab}`} className="ref-panel">
        {tab === 'summary' ? <Summary /> : null}
        {tab === 'codes' ? <CodesTab params={params} change={change} /> : null}
        {tab === 'referrals' ? <NewcomersTab params={params} change={change} /> : null}
        {tab === 'rewards' ? <RewardsTab params={params} change={change} /> : null}
      </div>
    </section>
  );
}

function Tile({ label, value, detail, children }: { label: string; value: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {detail ? <span className="stat-detail">{detail}</span> : null}
      {children}
    </div>
  );
}

/** The numbers at a glance, and how it works told with the live rules (no number of them is written in the copy). */
function Summary() {
  const id = useId();
  const summary = useReferralSummary();
  const { cfg } = useReferralsConfig();
  const s = summary.data;
  return (
    <>
      {summary.error ? (
        <p className="field-error" role="alert">
          {errorText(summary.error, copy.errors)}
        </p>
      ) : null}
      {s ? (
        <div className="stat-tiles ref-tiles">
          <Tile label={t.tiles.codes} value={fmt(s.codes.active)} detail={t.tiles.codesOf(s.codes.total)} />
          <Tile label={t.tiles.days7} value={fmt(s.signups.days7)} />
          <Tile label={t.tiles.days30} value={fmt(s.signups.days30)} />
          <Tile label={t.tiles.total} value={fmt(s.signups.total)} />
          <Tile label={t.tiles.activation} value={percent.format(s.activation)} detail={t.tiles.activationDetail} />
          <Tile label={t.tiles.held} value={fmt(s.held)} detail={t.tiles.heldDetail}>
            {s.held > 0 ? (
              <Link className="ref-tile-link" to={`?seccion=referidos&estado=${STATE_URL.held}`}>
                {t.tiles.review}
              </Link>
            ) : null}
          </Tile>
          <Tile label={t.tiles.rewarded} value={fmt(s.rewarded)} detail={t.tiles.rewardedDetail} />
        </div>
      ) : null}
      {cfg ? (
        <section className="lip panel stats-section ref-how" aria-labelledby={id}>
          <header className="stats-head">
            <h2 id={id}>{t.howTitle}</h2>
          </header>
          <p>{t.how(giftsText(cfg.newcomerGifts, t.nothing), cfg.activationLevel, giftsText(cfg.ownerGifts, t.nothing))}</p>
          <p>{t.howHeld}</p>
          <p>
            <b>{t.howRequired(cfg.required)}</b>
          </p>
          <p>{t.howOwn}</p>
        </section>
      ) : null}
    </>
  );
}
