import type { ChainId } from "@/lib/economy/networks";

// Labelled spenders (P6-R2c). Every address was checked at its official source on 2026-10-25 and has code on that
// chain (eth_getCode on the public RPCs, same day). An address that could not be checked at its source is left out:
// it only shows as «Desconocido».
//   - Permit2, Uniswap UniversalRouter and SwapRouter02: Uniswap docs «Deployments»
//     (developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments and …/v3-arbitrum-deployments).
//   - 1inch Aggregation Router v6: 1inch's official SDK (github.com/1inch/1inch-sdk-go, constants/contracts.go:
//     «identical for all chains except zkSync»); the portal (business.1inch.com) renders client-side only. Mainnets only.
//   - 0x AllowanceHolder (Cancun chains, Base and Arbitrum): docs.0x.org/docs/core-concepts/contracts. Mainnets only.
//   - Aerodrome Router: README of github.com/aerodrome-finance/contracts («Deployment»). Base only.

export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const ONEINCH_V6 = "0x111111125421cA6dc452d289314280a0f8842A65" as const;
const ZEROX_ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734" as const;

type Spender = { address: `0x${string}`; label: string };

const permit2: Spender = { address: PERMIT2, label: "Permit2" };

export const KNOWN_SPENDERS: Record<ChainId, ReadonlyArray<Spender>> = {
  8453: [
    permit2,
    { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", label: "Uniswap Universal Router" },
    { address: "0x2626664c2603336E57B271c5C0b26F421741e481", label: "Uniswap SwapRouter02" },
    { address: ONEINCH_V6, label: "1inch Router v6" },
    { address: ZEROX_ALLOWANCE_HOLDER, label: "0x AllowanceHolder" },
    { address: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", label: "Aerodrome Router" },
  ],
  42161: [
    permit2,
    { address: "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3", label: "Uniswap Universal Router" },
    { address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", label: "Uniswap SwapRouter02" },
    { address: ONEINCH_V6, label: "1inch Router v6" },
    { address: ZEROX_ALLOWANCE_HOLDER, label: "0x AllowanceHolder" },
  ],
  84532: [
    permit2,
    { address: "0x492E6456D9528771018DeB9E87ef7750EF184104", label: "Uniswap Universal Router" },
    { address: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4", label: "Uniswap SwapRouter02" },
  ],
  421614: [
    permit2,
    { address: "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2", label: "Uniswap Universal Router" },
    { address: "0x101F443B4d1b059569D643917553c771E1b9663E", label: "Uniswap SwapRouter02" },
  ],
};

/** The spender's label on `chain` (case-insensitive), or null when it is not on the list. */
export function spenderLabel(chain: ChainId, address: string): string | null {
  const a = address.toLowerCase();
  return KNOWN_SPENDERS[chain].find((s) => s.address.toLowerCase() === a)?.label ?? null;
}
