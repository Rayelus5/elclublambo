import { WithdrawButton } from "@/components/treasury/withdraw-button";
import { WithdrawalStatus } from "@/components/treasury/withdrawal-status";
import type { DaoOverview } from "@/lib/treasury/queries";

/**
 * What the position block shows about withdrawals: the status of the viewer's latest request (so an open one can be
 * followed or cancelled even if SuperAdmin switches the network off) and, only with the switch on and no active
 * request, the button. With the switch off and nothing to follow, nothing at all.
 */
export function WithdrawControls({ data }: { data: DaoOverview }) {
  const w = data.myWithdrawal;
  const active = w !== null && (w.status === "pending" || w.status === "approved");
  const canAsk = data.withdrawalsEnabled && data.myShares > 0n && !active;
  if (!w && !canAsk) return null;
  return (
    <div className="flex flex-col gap-3">
      {w ? <WithdrawalStatus withdrawal={w} chainId={data.chainId} /> : null}
      {canAsk ? (
        <div>
          <WithdrawButton myShares={data.myShares} sharePriceUsd6={data.sharePriceUsd6} />
        </div>
      ) : null}
    </div>
  );
}
