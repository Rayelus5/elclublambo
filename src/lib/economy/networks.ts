export type ChainId = 59144 | 59141;

export type Network = {
  id: ChainId;
  name: string;
  usdc: `0x${string}`;
  explorer: string;
  testnet: boolean;
};

/** USDC addresses from Circle's docs (developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-18). */
export const NETWORKS: Record<ChainId, Network> = {
  59144: {
    id: 59144,
    name: "Linea",
    usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
    explorer: "https://lineascan.build",
    testnet: false,
  },
  59141: {
    id: 59141,
    name: "Linea Sepolia",
    usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
    explorer: "https://sepolia.lineascan.build",
    testnet: true,
  },
};

export const CHAIN_IDS: ChainId[] = [59144, 59141];

export function isChainId(n: unknown): n is ChainId {
  return n === 59144 || n === 59141;
}

export function explorerTx(chain: ChainId, hash: string): string {
  return `${NETWORKS[chain].explorer}/tx/${hash}`;
}

export function explorerAddress(chain: ChainId, addr: string): string {
  return `${NETWORKS[chain].explorer}/address/${addr}`;
}

export const MAX_FEE_BPS = 5000;

/** 260 -> "2,6 %". Basis points to a percent with a decimal comma and no trailing zeros. */
export function bpsToPercentText(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${frac ? `,${frac}` : ""} %`;
}

/** "2,6" / "2.6" / "0,05" -> basis points. Null when malformed, over 50 % or with more than 2 decimals. */
export function percentTextToBps(text: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(bps) && bps <= MAX_FEE_BPS ? bps : null;
}

/** The fee over 10 USDC as "0,26" (at least 2 decimals, at most 4: 1 bps of 10 USDC is 0,001). */
export function feeOnTenUsdc(bps: number): string {
  const v = (bps / 1000).toFixed(4).replace(/0{1,2}$/, "");
  return v.replace(".", ",");
}
