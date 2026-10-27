// drand quicknet: the public randomness behind every giveaway draw (P1-R10, P1-R12). Isomorphic on purpose: the cron
// and «Sortear ahora» verify each beacon before handing it to SQL, and the public verifier runs the same check in the
// browser. Values verified on https://api.drand.sh/<hash>/info on 2026-10-24 (scheme bls-unchained-g1-rfc9380):
//   signature = BLS on G1 of sha256(round as uint64 big-endian), public key on G2
//   randomness = sha256(signature bytes)
import { bls12_381 } from "@noble/curves/bls12-381";
import { bytesToHex, hexToBytes, sha256 } from "viem";
import { networkSet } from "@/lib/economy/networks";

export const DRAND = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesis: 1692803367,
  period: 3,
  dst: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_",
} as const;

/** The public quicknet relays, tried in order. src/lib/security/headers.ts allows the same origins (a test pins it). */
export const DRAND_API_BASES = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh", "https://drand.cloudflare.com"] as const;

const FETCH_TIMEOUT_MS = 5000;
const SIG_RE = /^[0-9a-f]{96}$/;
const KEY_RE = /^[0-9a-f]{192}$/;

const strip0x = (hex: string) => (hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex);

/** The URL's origin + path without a trailing slash, or null unless http(s). */
function baseOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Where to fetch beacons and which key verifies them. The overrides (the e2e drand of e2e/mock/drand.mjs) are honoured
 * on the testnet set only (P1-R11): the server prefers DRAND_API_BASE, the browser only sees NEXT_PUBLIC_DRAND_API_BASE.
 * PRE does not set them, so it uses the real drand.
 */
export function drandConfig(): { apiBases: string[]; publicKey: string } {
  const fallback = { apiBases: [...DRAND_API_BASES], publicKey: DRAND.publicKey as string };
  if (networkSet() !== "testnet") return fallback;
  // Literal process.env.NEXT_PUBLIC_* reads so Next inlines them into the browser bundle.
  const base = baseOf(process.env.DRAND_API_BASE) ?? baseOf(process.env.NEXT_PUBLIC_DRAND_API_BASE);
  const key = strip0x(process.env.NEXT_PUBLIC_DRAND_PUBLIC_KEY?.trim() ?? "").toLowerCase();
  return { apiBases: base ? [base] : fallback.apiBases, publicKey: KEY_RE.test(key) ? key : fallback.publicKey };
}

/** Unix seconds at which `round` is emitted: genesis + (round - 1) * period. */
export function roundTime(round: bigint): number {
  return DRAND.genesis + Number(round - 1n) * DRAND.period;
}

/** The first round emitted strictly after `closesAt`, as SQL _giveaway_target_round computes it at creation. */
export function targetRound(closesAt: Date): bigint {
  return BigInt(Math.floor((closesAt.getTime() / 1000 - DRAND.genesis) / DRAND.period) + 2);
}

type G1Message = Parameters<typeof bls12_381.verifyShortSignature>[1];

function roundMessage(round: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, round);
  return sha256(bytes, "bytes");
}

/** BLS check of a quicknet beacon. Never throws: anything malformed is `{ ok: false }`. randomness is 64 hex, no 0x. */
export function verifyBeacon(
  round: bigint,
  signatureHex: string,
  publicKey: string = drandConfig().publicKey,
): { ok: true; randomness: string } | { ok: false } {
  const sig = strip0x(typeof signatureHex === "string" ? signatureHex : "").toLowerCase();
  if (typeof round !== "bigint" || round < 1n || round >= 2n ** 64n || !SIG_RE.test(sig)) return { ok: false };
  try {
    // hashToCurve's H2CPoint is the G1 point verifyShortSignature takes; only the declared types differ
    const point = bls12_381.G1.hashToCurve(roundMessage(round), { DST: DRAND.dst }) as unknown as G1Message;
    if (!bls12_381.verifyShortSignature(sig, point, strip0x(publicKey))) return { ok: false };
  } catch {
    return { ok: false };
  }
  const randomness = bytesToHex(sha256(hexToBytes(`0x${sig}`), "bytes")).slice(2);
  return { ok: true, randomness };
}

export type BeaconResult = { status: "ok"; signature: string; randomness: string } | { status: "unavailable" } | { status: "invalid" };

/**
 * Fetches `round` from each base in turn (5 s each) and returns the first answer whose signature verifies. "invalid"
 * when some base answered with a signature that does not verify and none with a good one; "unavailable" when none
 * answered at all (down, 425 not emitted yet, malformed): the caller waits and retries (Review Focus 5).
 */
export async function fetchBeacon(round: bigint, opts: { fetchImpl?: typeof fetch } = {}): Promise<BeaconResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const { apiBases, publicKey } = drandConfig();
  let sawInvalid = false;
  for (const base of apiBases) {
    let body: unknown;
    try {
      const res = await doFetch(`${base}/${DRAND.chainHash}/public/${round.toString()}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) continue;
      body = await res.json();
    } catch {
      continue;
    }
    const signature = (body as { signature?: unknown } | null)?.signature;
    if (typeof signature !== "string") continue;
    const check = verifyBeacon(round, signature, publicKey);
    if (check.ok) return { status: "ok", signature: strip0x(signature).toLowerCase(), randomness: check.randomness };
    sawInvalid = true;
  }
  return sawInvalid ? { status: "invalid" } : { status: "unavailable" };
}
