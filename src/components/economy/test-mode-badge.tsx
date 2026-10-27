import { networkSet } from "@/lib/economy/networks";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center rounded-control border border-warning px-2 py-1 font-mono text-[11px] leading-none font-bold tracking-wide whitespace-nowrap text-warning";

/**
 * Loud testnet notice, driven by the build's NEXT_PUBLIC_NETWORK_SET (P0-R12); nothing at all on mainnet.
 * `compact` is for the mobile top bar, where the full label does not fit (the drawer shows it in full).
 */
export function TestModeBadge({
  compact = false,
  responsive = false,
  className,
}: {
  compact?: boolean;
  /** Desktop top bar: compact below 1536px, full from there (CSS shows one of the two; the other is display:none). */
  responsive?: boolean;
  className?: string;
}) {
  if (networkSet() !== "testnet") return null;
  if (responsive) {
    return (
      <>
        <span role="img" aria-label="MODO PRUEBA" className={cn(base, "2xl:hidden", className)}>
          PRUEBA
        </span>
        <span className={cn(base, "hidden 2xl:inline-flex", className)}>MODO PRUEBA</span>
      </>
    );
  }
  if (compact) {
    return (
      <span role="img" aria-label="MODO PRUEBA" className={cn(base, className)}>
        PRUEBA
      </span>
    );
  }
  return <span className={cn(base, className)}>MODO PRUEBA</span>;
}
