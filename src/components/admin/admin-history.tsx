import { LocalTime } from "@/components/tickets/local-time";
import { describeAdminAction } from "@/lib/admin/labels";
import { shortAddress } from "@/lib/auth/wallet";

/** `admin_overview` gives the @handle, or the whole wallet when there is none. */
const actorText = (actor: string) => (/^0x[0-9a-fA-F]{40}$/.test(actor) ? shortAddress(actor) : actor);

export type HistoryItem = { at: string; actor: string; action: string; payload: Record<string, unknown> };

/** The last administration changes (newest first): when, who and what. */
export function AdminHistory({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) return <p className="text-sm text-fg-muted">Todavía no hay cambios.</p>;
  return (
    <ol className="flex flex-col divide-y divide-border rounded-panel border border-border bg-surface px-4">
      {history.map((h, i) => (
        <li key={`${h.at}-${i}`} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
          <LocalTime iso={h.at} className="shrink-0 font-mono text-[13px] text-fg-muted tabular-nums sm:w-32" />
          <p className="min-w-0 text-sm break-words text-fg">
            <span className="font-bold">{actorText(h.actor)}</span> {describeAdminAction(h.action, h.payload)}
          </p>
        </li>
      ))}
    </ol>
  );
}
