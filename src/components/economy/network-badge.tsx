import { isChainId, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { LEGACY_NETWORKS, type LegacyChainId } from "@/lib/legacy/linea";
import { cn } from "@/lib/utils";

const base = "inline-flex items-center rounded-control border px-2 py-1 font-mono text-[11px] leading-none font-bold tracking-wide whitespace-nowrap";

/**
 * Which network money moves on. Testnet is loud (warning token, "MODO PRUEBA"); mainnet is a quiet muted name.
 * `compact` is for the mobile top bar, where the full label does not fit (the drawer shows it in full).
 */
export function NetworkBadge({
  chainId,
  compact = false,
  responsive = false,
  className,
}: {
  /** A legacy id only from the legacy DAO overview, until Task 8 replaces this badge. */
  chainId: ChainId | LegacyChainId;
  compact?: boolean;
  /** Desktop top bar: compact below 1536px, full from there (CSS shows one of the two; the other is display:none). */
  responsive?: boolean;
  className?: string;
}) {
  const net = isChainId(chainId) ? NETWORKS[chainId] : LEGACY_NETWORKS[chainId];
  const full = net.testnet ? `MODO PRUEBA · ${net.name}` : net.name;
  const tone = net.testnet ? "border-warning text-warning" : "border-border text-fg-muted";
  if (responsive && net.testnet) {
    return (
      <>
        <span role="img" aria-label={full} className={cn(base, tone, "2xl:hidden", className)}>
          PRUEBA
        </span>
        <span className={cn(base, tone, "hidden 2xl:inline-flex", className)}>{full}</span>
      </>
    );
  }
  if (compact && net.testnet) {
    return (
      <span role="img" aria-label={full} className={cn(base, tone, className)}>
        PRUEBA
      </span>
    );
  }
  return <span className={cn(base, tone, className)}>{full}</span>;
}
