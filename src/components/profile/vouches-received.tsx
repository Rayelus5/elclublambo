import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routes";
import { kindRows } from "@/lib/vouches/kinds";
import type { VouchesSummary } from "@/lib/vouches/types";

const kinds = getDictionary("es").vouches.kinds;

/**
 * Read-only «Avales recibidos» on a forum profile (P5-R8): distinct attesters, the count per kind and a link to the
 * public tool, which is not a club page (so no clubPath). Nothing at all when the address has no vouches.
 */
export function VouchesReceived({ address, summary }: { address: string; summary: VouchesSummary }) {
  if (summary.total === 0) return null;
  return (
    <section aria-labelledby="vouches-received-title" className="flex flex-col gap-4">
      <h2 id="vouches-received-title" className="text-h2">
        Avales recibidos
      </h2>
      <p className="font-mono text-lg font-bold text-fg tabular-nums">{summary.total === 1 ? "1 aval" : `${summary.total} avales`}</p>
      <ul aria-label="Avalistas por tipo" className="flex flex-col gap-1 text-fg">
        {kindRows(summary.counts).map((r) => (
          <li key={r.key} className="tabular-nums">{`${kinds[r.key]} · ${r.attesters}`}</li>
        ))}
      </ul>
      <Link
        href={`${localizedPath("es", "vouches")}?address=${address}`}
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
      >
        Ver avales
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
}
