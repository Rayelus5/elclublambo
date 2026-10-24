import type { Chain } from "viem";
import { NETWORKS, appChainIds } from "@/lib/economy/networks";

/** The build's chains (NEXT_PUBLIC_NETWORK_SET) as viem chains, Base first: AppKit's networks and its default. */
export function appChains(): readonly [Chain, ...Chain[]] {
  const [first, ...rest] = appChainIds().map((id) => NETWORKS[id].viemChain);
  return [first!, ...rest];
}
