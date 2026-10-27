import { clubPath } from "@/lib/club/paths";
import Link from "next/link";
import { CHART_RANGES, type ChartRange } from "@/lib/market/types";
import { cn } from "@/lib/utils";

const LABEL: Record<ChartRange, string> = { "1": "24 h", "7": "7 d", "30": "30 d", "365": "1 a" };

/** Range selector as plain links (`?r=`), so the page stays a server component and the choice is shareable. */
export function RangeTabs({ id, active }: { id: string; active: ChartRange }) {
  return (
    // A phone gets one full-width segmented control (four equal thumb targets); wider screens keep it compact.
    <nav aria-label="Periodo del gráfico" className="grid grid-cols-4 gap-1 sm:inline-grid sm:self-start">
      {CHART_RANGES.map((r) => (
        <Link
          key={r}
          href={clubPath(`/mercado/${id}?r=${r}`)}
          scroll={false}
          aria-current={r === active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border px-3 text-[13px] font-bold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none",
            r === active ? "border-accent bg-surface-2 text-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {LABEL[r]}
        </Link>
      ))}
    </nav>
  );
}
