import { formatBps, formatUsdc } from "@/lib/treasury/format";
import type { RankingEntry } from "@/lib/treasury/queries";
import { cn } from "@/lib/utils";

/** Ranking by share. Hidden donors arrive from the server as "Anónimo" without an id; the viewer's own row is marked. */
export function DaoRanking({ entries, viewerId }: { entries: RankingEntry[]; viewerId: string | null }) {
  if (entries.length === 0) return <p className="text-fg-muted">Aún no hay aportaciones.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-collapse text-left text-sm">
        <caption className="sr-only">Ranking de la DAO</caption>
        <thead>
          <tr className="border-b border-border-strong text-fg-muted">
            <th scope="col" className="w-12 py-2 pr-2 font-bold">
              #
            </th>
            <th scope="col" className="py-2 pr-2 font-bold">
              Miembro
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-bold">
              %
            </th>
            <th scope="col" className="py-2 text-right font-bold">
              Aportado
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const mine = viewerId !== null && e.memberId === viewerId;
            return (
              <tr
                key={e.rank}
                aria-current={mine ? "true" : undefined}
                className={cn("min-h-11 border-b border-border", mine && "bg-surface-2 font-bold text-fg")}
              >
                <td className="py-3 pr-2 font-mono">{e.rank}</td>
                <td className="py-3 pr-2">
                  {e.label}
                  {mine ? <span className="ml-2 text-[13px] font-normal text-accent">(tú)</span> : null}
                </td>
                <td className="py-3 pr-2 text-right font-mono">{formatBps(e.shareBps)}</td>
                <td className="py-3 text-right font-mono">
                  {e.club ? <>
                      <span aria-hidden>—</span>
                      <span className="sr-only">Sin aportación propia</span>
                    </> : formatUsdc(e.netUsdc)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
