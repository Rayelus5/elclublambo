import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { cn } from "@/lib/utils";

/**
 * A network as its round logo. Bare, the logo carries the name as alt; with `withName` the name sits beside it
 * and the logo is decorative.
 */
export function NetworkLogo({
  chainId,
  size = 20,
  withName = false,
  decorative = false,
  className,
}: {
  chainId: ChainId;
  size?: number;
  withName?: boolean;
  /** The name is already in the surrounding text: the image gets an empty alt. */
  decorative?: boolean;
  className?: string;
}) {
  const net = NETWORKS[chainId];
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from /public
    <img
      src={net.logo}
      alt={withName || decorative ? "" : net.name}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", withName ? undefined : className)}
    />
  );
  if (!withName) return logo;
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold text-fg", className)}>
      {logo}
      <span>{net.name}</span>
    </span>
  );
}
