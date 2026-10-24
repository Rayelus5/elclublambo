import { shortAddress } from "@/lib/auth/wallet";
import type { Dictionary } from "@/lib/i18n";
import type { PublicEntry } from "@/lib/public-giveaways/types";

type EntryLabels = Dictionary["giveaways"]["detail"]["entries"];

/** Public list of entries (P2-R13): short addresses, numbered by position once the giveaway closed. */
export function EntriesList({ entries, viewerWallet, t }: { entries: readonly PublicEntry[]; viewerWallet: string | null; t: EntryLabels }) {
  if (entries.length === 0) return <p className="text-sm text-fg-muted">{t.empty}</p>;
  const me = viewerWallet?.toLowerCase() ?? null;
  // Positions exist only after the close; until then the order is the server's (entry order).
  const rows = [...entries].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  return (
    <ol aria-label={t.listLabel} className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {rows.map((e, i) => (
        <li key={`${e.walletAddress}-${i}`} className="flex min-w-0 items-center gap-3 text-sm">
          <span className="w-12 shrink-0 font-mono text-[13px] text-fg-muted tabular-nums">{e.position ?? "·"}</span>
          <span className="min-w-0 truncate font-mono" title={e.walletAddress}>
            {shortAddress(e.walletAddress)}
          </span>
          {me !== null && e.walletAddress.toLowerCase() === me ? <span className="text-[13px] font-bold text-accent">{t.you}</span> : null}
        </li>
      ))}
    </ol>
  );
}
