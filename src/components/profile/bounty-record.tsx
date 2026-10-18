import Link from "next/link";
import { CircleAlert } from "lucide-react";
import type { BountyRecord, UnpaidBounty } from "@/lib/bounties/queries";
import { formatAmount } from "@/lib/payments/amounts";

const DATE = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" });

/**
 * A member's bounty record as the viewer is allowed to see it (bounties in channels the viewer cannot see are not
 * counted). Nothing to say, nothing rendered. The unpaid ones link to the bounty message.
 */
export function BountyRecordSection({ record, unpaid }: { record: BountyRecord; unpaid: readonly UnpaidBounty[] }) {
  if (record.paid + record.paidLate + record.unpaid === 0) return null;
  return (
    <section aria-labelledby="bounty-record-title" className="flex flex-col gap-4">
      <h2 id="bounty-record-title" className="text-h2">
        Bounties
      </h2>
      <p className="text-fg">
        Bounties: {record.paid} {record.paid === 1 ? "pagado" : "pagados"} · {record.paidLate}{" "}
        {record.paidLate === 1 ? "pagado tarde" : "pagados tarde"} · {record.unpaid} {record.unpaid === 1 ? "impagado" : "impagados"}
      </p>
      {unpaid.length > 0 ? (
        <ul aria-label="Bounties impagados" className="flex flex-col gap-1">
          {unpaid.map((b) => (
            <li key={b.messageId}>
              <Link
                href={`/c/${b.channelId}?m=${b.messageId}`}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-border px-3 py-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" />
                <span className="font-mono font-bold text-fg">{`${formatAmount(b.amount, b.token)} ${b.token}`}</span>
                {b.solutionMarkedAt ? (
                  <span className="text-[13px] text-fg-muted">
                    Solución elegida el <time dateTime={b.solutionMarkedAt}>{DATE.format(new Date(b.solutionMarkedAt))}</time>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
