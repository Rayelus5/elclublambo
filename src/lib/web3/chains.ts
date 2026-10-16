import { linea, lineaSepolia } from "viem/chains";
import type { Chain } from "viem";

export const APP_CHAINS = [lineaSepolia, linea] as const;

export function getAppChain(): Chain {
  const name = process.env.NEXT_PUBLIC_CHAIN ?? "lineaSepolia";
  switch (name) {
    case "linea":
      return linea;
    case "lineaSepolia":
      return lineaSepolia;
    default:
      throw new Error(`Unknown NEXT_PUBLIC_CHAIN: ${name}`);
  }
}
