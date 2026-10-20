import { cn } from "@/lib/utils";

// Fixed shapes (no randomness: the server and the client draw the same thing). Widths of the name and of each line.
const ROWS: { name: string; lines: string[] }[] = [
  { name: "w-24", lines: ["w-3/5"] },
  { name: "w-32", lines: ["w-4/5", "w-2/5"] },
  { name: "w-20", lines: ["w-1/2"] },
  { name: "w-28", lines: ["w-11/12", "w-3/4", "w-1/3"] },
  { name: "w-24", lines: ["w-2/3"] },
];

const BAR = "rounded-control bg-surface-2";

/**
 * Fallback while a channel and its history load: the shape of the channel header and of a few messages in grey, in a
 * panel of the chat's own height, so nothing jumps when the real history arrives. It fades in after 150 ms
 * (`animate-loader-in`), so a fast channel switch shows nothing; the pulse stops under reduced motion. Screen readers
 * only hear «Cargando mensajes…».
 */
export function ChatHistoryLoading() {
  return (
    <div role="status" className="flex animate-loader-in flex-col gap-6">
      <span className="sr-only">Cargando mensajes…</span>
      <div aria-hidden="true" className="flex animate-pulse flex-col gap-6 motion-reduce:animate-none">
        <div className="flex flex-col gap-3">
          <div className={cn(BAR, "h-9 w-56 max-w-full")} />
          <div className={cn(BAR, "h-8 w-36")} />
        </div>
        <div
          data-skeleton-panel
          className="flex h-[calc(100dvh-13rem)] min-h-[28rem] flex-col justify-end gap-5 overflow-hidden rounded-panel border border-border bg-bg px-4 pt-3 pb-24 md:h-[calc(100dvh-15.5rem)]"
        >
          {ROWS.map((row, i) => (
            <div key={i} data-skeleton-message className="flex gap-3">
              <div className="size-8 shrink-0 rounded-full bg-surface-2" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                <div className={cn(BAR, "h-3", row.name)} />
                {row.lines.map((w, j) => (
                  <div key={j} className={cn(BAR, "h-3 max-w-xl", w)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
