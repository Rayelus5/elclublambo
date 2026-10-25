import { decodeAbiParameters, encodeAbiParameters, encodePacked, isAddress, keccak256, zeroAddress, zeroHash } from "viem";
import { chainForKey, networkSet } from "@/lib/economy/networks";
import type { VouchKind } from "./kinds";

/** Vouches live on Base only (P5-R1). */
export type VouchChainId = 8453 | 84532;

export function vouchChain(): VouchChainId {
  return chainForKey("base") as VouchChainId;
}

export function isVouchChain(n: unknown): n is VouchChainId {
  return n === 8453 || n === 84532;
}

/** OP Stack predeploys, the same on Base and Base Sepolia. */
export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;

type Env = Record<string, string | undefined>;

/** Literal member accesses only: Next inlines `process.env.NEXT_PUBLIC_X` in the client bundle, not `env.X`. */
const publicEnv = (): Env => ({
  NEXT_PUBLIC_NETWORK_SET: process.env.NEXT_PUBLIC_NETWORK_SET,
  NEXT_PUBLIC_EAS_ADDRESS: process.env.NEXT_PUBLIC_EAS_ADDRESS,
  NEXT_PUBLIC_EAS_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_EAS_REGISTRY_ADDRESS,
});

/**
 * The EAS and registry addresses. The env overrides (local chain without setCode, P5-R9 fallback) only count on the
 * testnet set and when they are valid addresses; on mainnet they are ignored.
 */
export function easAddresses(env: Env = publicEnv()): { eas: `0x${string}`; registry: `0x${string}` } {
  const testnet = networkSet(env.NEXT_PUBLIC_NETWORK_SET) === "testnet";
  const pick = (v: string | undefined, fallback: `0x${string}`) => (testnet && v && isAddress(v, { strict: false }) ? (v as `0x${string}`) : fallback);
  return { eas: pick(env.NEXT_PUBLIC_EAS_ADDRESS, EAS_ADDRESS), registry: pick(env.NEXT_PUBLIC_EAS_REGISTRY_ADDRESS, SCHEMA_REGISTRY_ADDRESS) };
}

export const VOUCH_SCHEMA = "uint8 kind";
export const VOUCH_RESOLVER = zeroAddress;
export const VOUCH_REVOCABLE = true;

/** EAS schema UID: keccak256(abi.encodePacked(schema, resolver, revocable)). */
export function vouchSchemaUid(schema: string = VOUCH_SCHEMA, resolver: `0x${string}` = VOUCH_RESOLVER, revocable: boolean = VOUCH_REVOCABLE): `0x${string}` {
  return keccak256(encodePacked(["string", "address", "bool"], [schema, resolver, revocable]));
}

export const VOUCH_SCHEMA_UID = vouchSchemaUid();

export function encodeVouchData(kind: VouchKind): `0x${string}` {
  return encodeAbiParameters([{ type: "uint8" }], [kind]);
}

/** The kind inside attestation data, or null when the data is not exactly one uint8 word. */
export function decodeVouchData(data: `0x${string}`): number | null {
  if (data.length !== 66) return null;
  try {
    const n = Number(decodeAbiParameters([{ type: "uint8" }], data)[0]);
    return n >= 0 && n <= 255 ? n : null; // viem does not range-check uint8
  } catch {
    return null;
  }
}

/** The exact `args` for `writeContract({ abi: easAbi, functionName: "attest" })`. */
export function attestArgs(recipient: `0x${string}`, kind: VouchKind) {
  return [
    {
      schema: VOUCH_SCHEMA_UID,
      data: { recipient, expirationTime: 0n, revocable: VOUCH_REVOCABLE, refUID: zeroHash, data: encodeVouchData(kind), value: 0n },
    },
  ] as const;
}

/** The exact `args` for `writeContract({ abi: easAbi, functionName: "revoke" })`. */
export function revokeArgs(uid: `0x${string}`) {
  return [{ schema: VOUCH_SCHEMA_UID, data: { uid, value: 0n } }] as const;
}

export function easscanUrl(chain: VouchChainId, uid: string): string {
  const host = chain === 8453 ? "base.easscan.org" : "base-sepolia.easscan.org";
  return `https://${host}/attestation/view/${uid}`;
}
