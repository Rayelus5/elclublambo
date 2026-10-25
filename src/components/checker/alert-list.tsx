import { CircleHelp, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Severity = "high" | "medium" | "info";
export type ReportAlert = { key: string; severity: Severity; title: string; text: string };
/** Something the report could not answer, with why («Desconocido» never counts as a pass). */
export type UnknownItem = { label: string; reason: string };

type SummaryLabels = Dictionary["checker"]["report"]["summary"];

const RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };
const SEVERITIES: Severity[] = ["high", "medium", "info"];

const STYLE: Record<Severity, { icon: LucideIcon; text: string; border: string }> = {
  high: { icon: OctagonAlert, text: "text-danger", border: "border-danger/70" },
  medium: { icon: TriangleAlert, text: "text-warning", border: "border-warning/70" },
  info: { icon: Info, text: "text-fg-muted", border: "border-border-strong" },
};

/**
 * The report's head: alerts counted by severity, then a line that never reads as a guarantee. With no alerts it says
 * so only for what was checked, and lists what could not be checked.
 */
export function ReportSummary({ t, alerts, unknowns }: { t: SummaryLabels; alerts: ReportAlert[]; unknowns: UnknownItem[] }) {
  const titleId = "checker-summary-title";
  const unknownId = "checker-unknown-title";
  const counts = SEVERITIES.map((s) => [s, alerts.filter((a) => a.severity === s).length] as const);
  return (
    <section role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="text-sm font-bold text-fg">
        {t.title}
      </h3>
      <dl className="grid grid-cols-3 gap-2">
        {counts.map(([s, n]) => {
          const { icon: Icon, text } = STYLE[s];
          return (
            <div key={s} className="flex flex-col gap-1 rounded-control border border-border bg-surface-2 p-3">
              <dt className={cn("flex items-center gap-1.5 text-[13px] font-bold", n > 0 ? text : "text-fg-muted")}>
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0">{t[s]}</span>
              </dt>
              <dd data-testid={`count-${s}`} className="font-display text-2xl font-bold tabular-nums text-fg">
                {n}
              </dd>
            </div>
          );
        })}
      </dl>
      {alerts.length === 0 ? (
        <p className="text-sm font-bold text-fg">{unknowns.length > 0 ? t.noAlertsPartial : t.noAlertsAll}</p>
      ) : null}
      {unknowns.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-control border border-dashed border-border-strong p-3">
          <p id={unknownId} className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <CircleHelp aria-hidden className="size-4 shrink-0 text-fg-muted" />
            {t.unknownTitle}
          </p>
          <ul aria-labelledby={unknownId} className="flex flex-col gap-1 text-sm text-fg-muted">
            {unknowns.map((u) => (
              <li key={u.label}>{`${u.label} · ${u.reason}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** The alerts, most severe first; severity shows as icon and label, never colour alone. */
export function AlertList({ title, labels, alerts }: { title: string; labels: SummaryLabels; alerts: ReportAlert[] }) {
  if (alerts.length === 0) return null;
  const sorted = [...alerts].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-fg">{title}</h3>
      <ul className="flex flex-col gap-2">
        {sorted.map((a) => {
          const { icon: Icon, text, border } = STYLE[a.severity];
          return (
            <li key={a.key} className={cn("flex items-start gap-3 rounded-control border p-3", border)}>
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", text)} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex flex-wrap gap-x-1.5 text-sm">
                  <span className="font-bold text-fg">{a.title}</span>
                  <span className={text}>· {labels[a.severity]}</span>
                </p>
                <p className="break-words text-sm text-fg-muted">{a.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
