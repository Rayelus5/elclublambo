import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { AlertList, ReportSummary, type ReportAlert, type UnknownItem } from "@/components/checker/alert-list";
import { NetworkLogo } from "@/components/economy/network-logo";
import type { Section, TokenReport as Report, UnknownReason } from "@/lib/checker/token/types";
import { explorerAddress, NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { DATE_LOCALE, fill } from "@/lib/i18n/fill";

type T = Dictionary["checker"];
type Row = { key: string; label: string } & ({ value: ReactNode } | { unknown: string });

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent";

export function AddressLink({ chain, address }: { chain: ChainId; address: string }) {
  return (
    <a
      href={explorerAddress(chain, address)}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all font-mono text-sm text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
    >
      {address}
    </a>
  );
}

/** «Desconocido» plus why, each in its own element: an unanswered section reads as unknown, never as a pass. */
function UnknownValue({ t, reason }: { t: T; reason: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="font-bold text-fg">{t.report.unknown}</span>
      <span aria-hidden className="text-fg-muted">
        ·
      </span>
      <span className="text-fg-muted">{reason}</span>
    </span>
  );
}

function reasonText(t: T, chain: ChainId, section: string, reason: UnknownReason): string {
  if (section === "market" && reason === "unsupported" && NETWORKS[chain].testnet) return t.report.values.testnetMarket;
  return t.report.reasons[reason];
}

/** The report's rows (one per thing checked) and the list of what stayed unknown. Pure. */
export function tokenRows(t: T, lang: Lang, report: Report): { rows: Row[]; unknowns: UnknownItem[] } {
  const { facts: f } = report;
  const v = t.report.values;
  const s = t.report.sections;
  const rows: Row[] = [];
  const unknowns: UnknownItem[] = [];
  const usd = new Intl.NumberFormat(DATE_LOCALE[lang], { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  function add<D>(key: string, label: string, section: Section<D>, render: (data: D) => ReactNode) {
    if (section.status === "unknown") {
      const reason = reasonText(t, f.chainId, key, section.reason);
      rows.push({ key, label, unknown: reason });
      unknowns.push({ label, reason });
    } else rows.push({ key, label, value: render(section.data) });
  }
  const unknownRow = (key: string, label: string, reason: UnknownReason) => {
    const text = reasonText(t, f.chainId, key, reason);
    rows.push({ key, label, unknown: text });
    unknowns.push({ label, reason: text });
  };

  add("code", s.code, f.code, (d) => (d.hasCode ? v.hasCode : v.noCode));
  add("erc20", s.erc20, f.erc20, (d) =>
    d ? fill(v.tokenLine, { name: d.name ?? "—", symbol: d.symbol ?? "—", decimals: d.decimals }) : v.notErc20,
  );
  add("verification", s.verification, f.verification, (d) =>
    d.verified ? fill(v.verified, { source: d.source === "sourcify" ? "Sourcify" : "Blockscout" }) : v.notVerified,
  );
  // Privileged functions only exist for verified code; null = verified but its ABI could not be read.
  if (f.verification.status === "ok" && f.verification.data.verified) {
    const flags = f.verification.data.abiFlags;
    if (flags === null) unknownRow("privileged", s.privileged, "error");
    else rows.push({ key: "privileged", label: s.privileged, value: flags.length ? <span className="font-mono">{flags.join(", ")}</span> : v.noPrivileged });
  }
  add("proxy", s.proxy, f.proxy, (d) =>
    !d.isProxy ? (
      v.notProxy
    ) : d.implementation ? (
      <span className="flex flex-col gap-1">
        <span>{v.proxyNoImpl}</span>
        <AddressLink chain={f.chainId} address={d.implementation} />
      </span>
    ) : (
      v.proxyNoImpl
    ),
  );
  add("owner", s.owner, f.owner, (d) =>
    !d ? (
      v.noOwner
    ) : d.renounced || !d.owner ? (
      v.renounced
    ) : (
      <span className="flex flex-col gap-1">
        <span>{v.ownerActive}</span>
        <AddressLink chain={f.chainId} address={d.owner} />
      </span>
    ),
  );
  add("creation", s.creation, f.creation, (d) =>
    d.creator ? (
      <span className="flex flex-col gap-1">
        <span>{v.createdBy}</span>
        <AddressLink chain={f.chainId} address={d.creator} />
      </span>
    ) : (
      v.ageNone
    ),
  );
  if (f.creation.status === "ok") {
    const c = f.creation.data;
    if (c.ageUnknown) unknownRow("age", s.age, c.ageUnknown);
    else if (c.ageDays !== null) rows.push({ key: "age", label: s.age, value: c.ageDays === 0 ? v.ageToday : fill(v.ageDays, { days: c.ageDays }) });
  }
  add("market", s.market, f.market, (d) => (
    <span className="flex flex-col gap-0.5">
      <span>{fill(v.pairs, { pairs: d.pairs })}</span>
      <span>{d.liquidityUsd === null ? v.noLiquidity : fill(v.liquidity, { usd: usd.format(d.liquidityUsd) })}</span>
      {d.priceUsd ? <span>{fill(v.price, { usd: `${d.priceUsd} USD` })}</span> : null}
    </span>
  ));
  return { rows, unknowns };
}

export function tokenAlertItems(t: T, report: Report): ReportAlert[] {
  const flags = report.facts.verification.status === "ok" ? (report.facts.verification.data.abiFlags ?? []) : [];
  return report.alerts.map((a) => ({
    key: a.code,
    severity: a.severity,
    title: t.alerts.token[a.code].title,
    text: fill(t.alerts.token[a.code].text, { flags: flags.join(", ") }),
  }));
}

/** A token's report: header, summary, alerts, one row per check (unknowns explained) and outbound links. */
export function TokenReport({ t, lang, report, actions }: { t: T; lang: Lang; report: Report; actions: ReactNode }) {
  const { facts: f } = report;
  const { rows, unknowns } = tokenRows(t, lang, report);
  const alerts = tokenAlertItems(t, report);
  const erc20 = f.erc20.status === "ok" ? f.erc20.data : null;
  const market = f.market.status === "ok" ? f.market.data : null;
  const checked = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(report.checkedAt),
  );

  return (
    <article aria-labelledby="checker-report-title" className="flex flex-col gap-6 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <h2 id="checker-report-title" className="font-display text-2xl font-bold text-fg">
          {t.report.tokenTitle}
        </h2>
        {erc20?.symbol ? (
          <p className="text-base font-bold text-fg">
            {erc20.name ?? erc20.symbol} <span className="text-fg-muted">({erc20.symbol})</span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <NetworkLogo chainId={f.chainId} size={20} withName className="text-sm" />
          <AddressLink chain={f.chainId} address={f.address} />
        </div>
        <p className="text-[13px] text-fg-muted">
          <time dateTime={report.checkedAt}>{fill(t.report.checkedAt, { date: `${checked} UTC` })}</time>
        </p>
      </header>

      <ReportSummary t={t.report.summary} alerts={alerts} unknowns={unknowns} />
      <AlertList title={t.report.summary.alertsTitle} labels={t.report.summary} alerts={alerts} />

      <dl className="flex flex-col divide-y divide-border border-y border-border">
        {rows.map((r) => (
          <div key={r.key} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-sm text-fg-muted">{r.label}</dt>
            <dd className="min-w-0 text-sm text-fg">{"unknown" in r ? <UnknownValue t={t} reason={r.unknown} /> : r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <a href={explorerAddress(f.chainId, f.address)} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {t.report.explorer}
          <ExternalLink aria-hidden className="size-4" />
        </a>
        {market?.topPairUrl && /^https:\/\//.test(market.topPairUrl) ? (
          <a href={market.topPairUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {t.report.dexscreener}
            <ExternalLink aria-hidden className="size-4" />
          </a>
        ) : null}
      </div>
      {actions}
    </article>
  );
}
