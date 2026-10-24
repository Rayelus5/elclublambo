import { ExternalLink } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { explorerTx } from "@/lib/economy/networks";
import { formatAmount } from "@/lib/payments/amounts";
import { donorLabel, type TipEntry } from "@/lib/payments/queries";
import { cn } from "@/lib/utils";

const RELATIVE = new Intl.RelativeTimeFormat("es", { numeric: "always" });
const ABSOLUTE = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

/** "hace 3 minutos", "hace 2 días". Anything under a minute is "hace unos segundos". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  for (const [unit, size] of STEPS) {
    if (seconds >= size) return RELATIVE.format(-Math.floor(seconds / size), unit);
  }
  return "hace unos segundos";
}

/**
 * The donor list: each tip as donor label, amount, time and explorer link. `time="absolute"` renders a fixed date
 * (server-rendered lists such as the profile); "relative" is for client-side popovers. `withNetwork` adds each tip's
 * network logo next to its amount (lists that mix networks).
 */
export function TipList({
  entries,
  time = "relative",
  withNetwork = false,
  className,
}: {
  entries: readonly TipEntry[];
  time?: "relative" | "absolute";
  withNetwork?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col divide-y divide-border", className)}>
      {entries.map((e) => (
        <li key={e.tipId} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span className="min-w-0 flex-1 truncate font-display font-bold text-fg">{donorLabel(e)}</span>
          <span className="inline-flex items-center gap-2 font-mono text-sm text-fg">
            {formatAmount(e.amount, e.token)} {e.token}
            {withNetwork ? <NetworkLogo chainId={e.chainId} size={16} /> : null}
          </span>
          {e.messageDeleted ? <span className="text-[13px] text-fg-muted italic">Mensaje eliminado</span> : null}
          <time dateTime={e.createdAt} suppressHydrationWarning className="text-[13px] text-fg-muted">
            {time === "relative" ? relativeTime(e.createdAt) : ABSOLUTE.format(new Date(e.createdAt))}
          </time>
          {e.txHash ? (
            <a
              href={explorerTx(e.chainId, e.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ver transacción en el explorador"
              className="inline-flex size-11 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ExternalLink aria-hidden className="size-4" />
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
