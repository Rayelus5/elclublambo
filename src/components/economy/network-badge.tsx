import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { cn } from "@/lib/utils";

const base = "inline-flex items-center rounded-control border px-2 py-1 font-mono text-[11px] leading-none font-bold tracking-wide whitespace-nowrap";

/**
 * Which network money moves on. Testnet is loud (warning token, "MODO PRUEBA"); mainnet is a quiet muted name.
 * `compact` is for the mobile top bar, where the full label does not fit (the drawer shows it in full).
 */
export function NetworkBadge({ chainId, compact = false, className }: { chainId: ChainId; compact?: boolean; className?: string }) {
  const net = NETWORKS[chainId];
  const full = net.testnet ? `MODO PRUEBA · ${net.name}` : net.name;
  const tone = net.testnet ? "border-warning text-warning" : "border-border text-fg-muted";
  if (compact && net.testnet) {
    return (
      <span role="img" aria-label={full} className={cn(base, tone, className)}>
        PRUEBA
      </span>
    );
  }
  return <span className={cn(base, tone, className)}>{full}</span>;
}
