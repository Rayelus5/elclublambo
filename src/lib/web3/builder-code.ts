import { concat, numberToHex, stringToHex } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { BUILDER_CODE_RE } from "@/lib/web3/builder-code-format";

export { BUILDER_CODE_RE };

/** ERC-8021 marker: sixteen bytes of 0x8021, always the last bytes of the attributed calldata. */
export const ERC8021_MARKER = "0x80218021802180218021802180218021";

/**
 * ERC-8021 schema 0 suffix: hex(codes joined by ",") || uint8(length in bytes) || 0x00 (schema id) || marker.
 * Same byte layout as wevm/ox `Attribution.toDataSuffix`.
 */
export function builderCodeSuffix(codes: readonly string[]): `0x${string}` {
  if (codes.length === 0) throw new Error("builderCodeSuffix: at least one code is required");
  for (const code of codes) {
    if (!BUILDER_CODE_RE.test(code)) throw new Error(`builderCodeSuffix: invalid builder code "${code}"`);
  }
  const codesHex = stringToHex(codes.join(","));
  const length = (codesHex.length - 2) / 2;
  if (length > 255) throw new Error("builderCodeSuffix: codes exceed 255 bytes");
  return concat([codesHex, numberToHex(length, { size: 1 }), "0x00", ERC8021_MARKER]);
}

/**
 * The attribution suffix for transfers on `chain`: only the Base network carries it (never Arbitrum). A malformed code
 * is logged and skipped rather than blocking the payment; the deploy readiness check refuses it in production.
 */
export function dataSuffixFor(chain: ChainId, code: string | undefined = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE): `0x${string}` | undefined {
  if (NETWORKS[chain].key !== "base" || !code) return undefined;
  if (!BUILDER_CODE_RE.test(code)) {
    console.error(`dataSuffixFor: invalid NEXT_PUBLIC_BASE_BUILDER_CODE "${code}", sending without attribution`);
    return undefined;
  }
  return builderCodeSuffix([code]);
}
