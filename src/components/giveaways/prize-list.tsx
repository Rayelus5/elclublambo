import { MarkPaidButton } from "@/components/giveaways/mark-paid-dialog";
import { PrizeLabel, PrizeStatus } from "@/components/giveaways/prize-status";
import { MarkDeliveredButton } from "@/components/giveaways/treasurer-actions";
import { isChainId } from "@/lib/economy/networks";
import { isWin } from "@/lib/giveaways/format";
import type { GiveawayPrizeState } from "@/lib/giveaways/types";

const WON = new Set(["awarded", "paid", "delivered"]);

function PrizeActions({ prize: p }: { prize: GiveawayPrizeState }) {
  if (p.status !== "awarded") return null;
  if (p.kind === "crypto" && isChainId(p.chainId)) {
    return <MarkPaidButton prizeId={p.id} label={p.label} chainId={p.chainId} winnerAddress={p.winnerAddress} />;
  }
  if (p.kind === "custom") return <MarkDeliveredButton prizeId={p.id} />;
  return null;
}

/** Who got the prize. An unawarded prize keeps its drawn position (the verifier counts it) but names nobody. */
function Winner({ prize: p }: { prize: GiveawayPrizeState }) {
  const position = p.winnerPosition !== null ? <span className="font-mono tabular-nums">{` · posición ${p.winnerPosition}`}</span> : null;
  if (!WON.has(p.status)) {
    return p.winnerPosition !== null ? <p className="pl-8 text-sm text-fg-muted">{`Posición sorteada: ${p.winnerPosition}`}</p> : null;
  }
  if (!p.winnerLabel && !isWin(p)) return null;
  return (
    <p className="pl-8 text-sm text-fg-muted">
      {isWin(p) ? <strong className="font-bold text-success">Tú</strong> : <span className="text-fg">{p.winnerLabel}</span>}
      {position}
    </p>
  );
}

/** The prizes of a giveaway by rank, with their state and, for treasurers, «Marcar pagado» / «Marcar entregado». */
export function PrizeList({ prizes, treasurer }: { prizes: readonly GiveawayPrizeState[]; treasurer: boolean }) {
  return (
    <ol aria-label="Premios del sorteo" className="flex flex-col divide-y divide-border">
      {prizes.map((p) => (
        <li key={p.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-5 shrink-0 font-mono text-[13px] text-fg-muted tabular-nums">{`${p.rank}.`}</span>
              <PrizeLabel prize={p} />
            </div>
            <Winner prize={p} />
          </div>
          <div className="flex flex-col items-start gap-2 pl-8 sm:items-end sm:pl-0">
            <PrizeStatus prize={p} />
            {treasurer ? <PrizeActions prize={p} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
