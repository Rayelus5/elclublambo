import type { ReactNode } from "react";
import { BadgeInfo } from "lucide-react";
import { AlertList, ReportSummary, type ReportAlert } from "@/components/checker/alert-list";
import type { LinkReport as Report } from "@/lib/checker/link/analyze";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";

type T = Dictionary["checker"];
type OkReport = Extract<Report, { ok: true }>;

export function linkAlertItems(t: T, report: OkReport): ReportAlert[] {
  return report.alerts.map((a) => ({
    key: a.code,
    severity: a.severity,
    title: t.alerts.link[a.code].title,
    text: fill(t.alerts.link[a.code].text, { detail: a.detail ?? report.hostUnicode }),
  }));
}

/**
 * A link's report: the domain as the eye reads it (and as the browser types it when they differ), the connection, the
 * alerts. Local analysis only: the URL is never requested. «Dominio conocido» is a fact about a list, not a verdict.
 */
export function LinkReport({ t, report, actions }: { t: T; report: OkReport; actions: ReactNode }) {
  const l = t.report.link;
  const alerts = linkAlertItems(t, report);
  return (
    <article aria-labelledby="checker-report-title" className="flex flex-col gap-6 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <h2 id="checker-report-title" className="font-display text-2xl font-bold text-fg">
          {t.report.linkTitle}
        </h2>
        <p className="break-all font-mono text-sm text-fg-muted">{report.url}</p>
        <p className="text-[13px] text-fg-muted">{l.local}</p>
      </header>

      <ReportSummary t={t.report.summary} alerts={alerts} unknowns={[]} />
      {report.isKnown ? (
        <p className="flex items-start gap-2 rounded-control border border-border-strong p-3 text-sm text-fg">
          <BadgeInfo aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          {l.known}
        </p>
      ) : null}
      <AlertList title={t.report.summary.alertsTitle} labels={t.report.summary} alerts={alerts} />

      <dl className="flex flex-col divide-y divide-border border-y border-border">
        <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <dt className="text-sm text-fg-muted">{l.host}</dt>
          <dd className="min-w-0 break-all font-mono text-sm text-fg">{report.hostUnicode}</dd>
        </div>
        {report.hostUnicode !== report.host ? (
          <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-sm text-fg-muted">{l.hostAscii}</dt>
            <dd className="min-w-0 break-all font-mono text-sm text-fg">{report.host}</dd>
          </div>
        ) : null}
        <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <dt className="text-sm text-fg-muted">{l.scheme}</dt>
          <dd className="text-sm text-fg">{report.scheme === "https" ? l.https : l.http}</dd>
        </div>
      </dl>
      {actions}
    </article>
  );
}
