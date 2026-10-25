import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { isChainId, type ChainId } from "@/lib/economy/networks";
import { tokenAlerts } from "./alerts";
import {
  abiFlags,
  blockscoutAbi,
  blockscoutAddress,
  blockscoutTxTime,
  checkerSources,
  dexscreenerMarket,
  readChain,
  sourcifyContract,
  type BlockscoutAddress,
} from "./sources";
import { ok, unknown, type CreationData, type ProxyData, type Section, type TokenFacts, type TokenReport, type VerificationData } from "./types";

const DAY_MS = 86_400_000;

/**
 * Verification: Blockscout's answer first (it also imports Sourcify), Sourcify as the fallback (P4-R1). A positive from
 * either is verified. A negative from Blockscout is «not verified»; a negative from Sourcify alone is not enough (the
 * contract may be verified elsewhere), so with Blockscout down the section stays unknown with Blockscout's reason.
 * The ABI flags come from Blockscout's ABI, else Sourcify's; with neither readable they are unknown (null), not «none».
 */
function verificationOf(
  bs: Section<BlockscoutAddress>,
  sf: Awaited<ReturnType<typeof sourcifyContract>>,
  bsAbi: Section<unknown[]> | null,
): Section<VerificationData> {
  const sfAbi = sf.status === "ok" ? sf.data.abi : null;
  const flags = (abi: unknown[] | null) => (abi === null ? null : abiFlags(abi));
  if (bs.status === "ok" && bs.data.verified) {
    return ok({ verified: true, source: "blockscout", abiFlags: flags(bsAbi?.status === "ok" ? bsAbi.data : sfAbi) });
  }
  if (sf.status === "ok" && sf.data.verified) return ok({ verified: true, source: "sourcify", abiFlags: flags(sfAbi) });
  if (bs.status === "ok") return ok({ verified: false, source: "blockscout", abiFlags: [] });
  return unknown(bs.reason);
}

/**
 * Creator and scam flag come with the address; the age needs the creation transaction. If that lookup fails the age is
 * unknown (`ageUnknown` = its reason) while the rest stays: a scam flag must not be lost to a slow second request.
 */
function creationOf(bs: Section<BlockscoutAddress>, tx: Section<string> | null): Section<CreationData> {
  if (bs.status !== "ok") return unknown(bs.reason);
  const createdAt = tx?.status === "ok" ? tx.data : null;
  const ageDays = createdAt === null ? null : Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / DAY_MS));
  const ageUnknown = tx?.status === "unknown" ? tx.reason : null;
  return ok({ creator: bs.data.creator, createdAt, ageDays, ageUnknown, isScam: bs.data.isScam });
}

/** The RPC's EIP-1967 read decides; Blockscout's detected implementation (other proxy patterns) can only add to it. */
function proxyOf(rpc: Section<ProxyData>, bs: Section<BlockscoutAddress>): Section<ProxyData> {
  if (rpc.status !== "ok" || rpc.data.isProxy) return rpc;
  const impl = bs.status === "ok" ? bs.data.implementation : null;
  return impl ? ok({ isProxy: true, implementation: impl }) : rpc;
}

/**
 * Everything the checker can learn about `address` on `chain`, from every source in parallel (each bounded by its
 * timeout), plus the alerts. Never throws for a failing source: it becomes an unknown section. Server-only, at request
 * time (callers `await connection()` first: no RPC or external read at build).
 */
export async function analyzeToken(chain: ChainId, address: `0x${string}`): Promise<TokenReport> {
  // Both go into source URLs and lookups: the callers validate them, this guards anyway.
  if (!isChainId(chain)) throw new Error("analyzeToken: invalid chain");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("analyzeToken: invalid address");
  const a = address.toLowerCase() as `0x${string}`;
  const src = checkerSources(chain);
  const [chainFacts, bs, sf, market] = await Promise.all([
    readChain(chain, a),
    blockscoutAddress(src.blockscout, a),
    sourcifyContract(src.sourcify, chain, a),
    src.dexscreener ? dexscreenerMarket(src.dexscreener, a) : Promise.resolve(unknown<never>("unsupported")),
  ]);
  const b = bs.status === "ok" ? bs.data : null;
  const [creationTx, bsAbi] = await Promise.all([
    b?.creationTx ? blockscoutTxTime(src.blockscout, b.creationTx) : null,
    b?.verified ? blockscoutAbi(src.blockscout, a) : null,
  ]);

  const facts: TokenFacts = {
    chainId: chain,
    address: a,
    code: chainFacts.code,
    erc20: chainFacts.erc20,
    proxy: chainFacts.code.status === "ok" && chainFacts.code.data.hasCode ? proxyOf(chainFacts.proxy, bs) : chainFacts.proxy,
    owner: chainFacts.owner,
    verification: verificationOf(bs, sf, bsAbi),
    creation: creationOf(bs, creationTx),
    market,
  };
  return { facts, alerts: tokenAlerts(facts), checkedAt: new Date().toISOString() };
}

/** P4-R7: a token report is reused for 10 minutes (a token verified meanwhile shows up within that window). */
export const TOKEN_REPORT_CACHE = { stale: 300, revalidate: 600, expire: 1200 } as const;

const SECTIONS = ["code", "erc20", "proxy", "owner", "verification", "creation", "market"] as const;

/**
 * Not worth keeping for 10 minutes: a report with no `ok` section at all, whatever the reasons (timeouts, rate limits,
 * a challenge… are all transient from the reader's side). One answering source makes the report cacheable.
 */
export function totalFailure(f: TokenFacts): boolean {
  return SECTIONS.every((k) => f[k].status === "unknown");
}

/**
 * The total failure handed to getTokenReport outside the cache (the receipt-cache pattern of P3): the cached scope
 * throws so nothing is stored and leaves the fresh report here (keyed `chain:address`, read-and-delete), so that view
 * still costs a single analysis. Capped so entries never collected cannot pile up.
 */
const stash = new Map<string, TokenReport>();
const STASH_MAX = 1_000;
const reportKey = (chain: ChainId, address: string) => `${chain}:${address}`;

export class SourcesDown extends Error {}

export async function cachedTokenReport(chain: ChainId, address: `0x${string}`): Promise<TokenReport> {
  "use cache";
  const r = await analyzeToken(chain, address);
  if (totalFailure(r.facts)) {
    if (stash.size >= STASH_MAX) stash.clear();
    stash.set(reportKey(chain, address), r);
    throw new SourcesDown();
  }
  cacheLife(TOKEN_REPORT_CACHE);
  cacheTag(`checker-token:${chain}:${address}`);
  return r;
}

/** The token report, cached per (chain, lowercased address). Request time only (after `await connection()`). */
export async function getTokenReport(chain: ChainId, address: `0x${string}`): Promise<TokenReport> {
  const a = address.toLowerCase() as `0x${string}`;
  try {
    return await cachedTokenReport(chain, a);
  } catch (e) {
    unstable_rethrow(e);
    const key = reportKey(chain, a);
    const r = stash.get(key);
    stash.delete(key);
    return r ?? (await analyzeToken(chain, a));
  }
}
