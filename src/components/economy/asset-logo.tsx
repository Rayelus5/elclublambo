import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";

const TOKEN_LOGO: Record<Token, string> = { USDC: "/brand/tokens/usdc.svg", ETH: "/brand/tokens/eth.svg" };

/**
 * A payable asset: the round token logo with its network's logo small, round, bottom right. USDC and ETH exist on
 * both networks, so the network badge is always shown. The ring keeps the badge legible on bg and surface-2.
 */
export function AssetLogo({ token, chainId, size = 28 }: { token: Token; chainId: ChainId; size?: number }) {
  const net = NETWORKS[chainId];
  const badge = Math.round(size * 0.45);
  return (
    <span
      role="img"
      aria-label={`${token} en ${net.name}`}
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable @next/next/no-img-element -- tiny static SVGs from /public */}
      <img src={TOKEN_LOGO[token]} alt="" width={size} height={size} className="rounded-full" />
      <img
        src={net.logo}
        alt=""
        width={badge}
        height={badge}
        className="absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-bg"
      />
      {/* eslint-enable @next/next/no-img-element */}
    </span>
  );
}
