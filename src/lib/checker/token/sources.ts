import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  erc20Abi,
  HttpRequestError,
  LimitExceededRpcError,
  TimeoutError,
} from "viem";
import { NETWORKS, networkSet, type ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { ok, unknown, type Erc20Data, type OwnerData, type ProxyData, type Section, type UnknownReason } from "./types";

// The checker's keyless sources (P4-R1): the club's own RPC, Blockscout v2, Sourcify v2 (verification fallback) and
// DexScreener. Every request is server-side, bounded by a 5 s timeout and identified by its User-Agent; a source that
// fails becomes an `unknown` section with the reason, never an exception.

export const CHECKER_USER_AGENT = "ElClub-Checker/1 (+https://www.elclub.party)";
const FETCH_TIMEOUT_MS = 5000;
/** The RPC reads share one deadline, so a slow node cannot hold the report past the HTTP sources' timeout. */
const RPC_DEADLINE_MS = 6000;

const BLOCKSCOUT: Record<ChainId, string> = {
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  84532: "https://base-sepolia.blockscout.com",
  421614: "https://arbitrum-sepolia.blockscout.com",
};
const SOURCIFY = "https://sourcify.dev/server";
const DEXSCREENER = "https://api.dexscreener.com";

export type CheckerSources = { blockscout: string; sourcify: string; dexscreener: { base: string; slug: "base" | "arbitrum" } | null };

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
 * Where to ask about `chain`. DexScreener has mainnet data only (a testnet chain gets null → `unsupported`). The
 * overrides (`CHECKER_BLOCKSCOUT_BASE_<chainId>`, `CHECKER_SOURCIFY_BASE`, `CHECKER_DEXSCREENER_BASE`, the e2e mock)
 * are honoured on the testnet set only, as drandConfig() does; PRE does not set them.
 */
export function checkerSources(chain: ChainId, env: Record<string, string | undefined> = process.env): CheckerSources {
  const testSet = networkSet(env.NEXT_PUBLIC_NETWORK_SET) === "testnet";
  const over = (name: string) => (testSet ? baseOf(env[name]) : null);
  const net = NETWORKS[chain];
  return {
    blockscout: over(`CHECKER_BLOCKSCOUT_BASE_${chain}`) ?? BLOCKSCOUT[chain],
    sourcify: over("CHECKER_SOURCIFY_BASE") ?? SOURCIFY,
    dexscreener: net.testnet ? null : { base: over("CHECKER_DEXSCREENER_BASE") ?? DEXSCREENER, slug: net.key },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP

export type Fetched = { kind: "ok"; json: unknown } | { kind: "not_found" } | { kind: "fail"; reason: UnknownReason };

const CLOUDFLARE_CHALLENGE = /just a moment|cf-chl|challenge-platform/i;

/** AbortSignal.timeout rejects with a DOMException named TimeoutError (AbortError on older runtimes); not always an Error. */
const isTimeout = (e: unknown) => {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : null;
  return name === "TimeoutError" || name === "AbortError";
};

/** GET a JSON document: 404 → not_found; timeout, 429, a Cloudflare challenge (blocked) or anything else → fail. */
export async function getJson(url: string): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": CHECKER_USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return { kind: "fail", reason: isTimeout(e) ? "timeout" : "error" };
  }
  try {
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 429) return { kind: "fail", reason: "rate_limited" };
    const text = await res.text();
    const challenged = res.headers.has("cf-mitigated") || CLOUDFLARE_CHALLENGE.test(text.slice(0, 4096));
    // A Cloudflare challenge can come with any 4xx/5xx (403, 503…): blocked, checked before the generic failure.
    if (!res.ok) return { kind: "fail", reason: challenged ? "blocked" : "error" };
    try {
      return { kind: "ok", json: JSON.parse(text) as unknown };
    } catch {
      return { kind: "fail", reason: challenged ? "blocked" : "error" };
    }
  } catch (e) {
    return { kind: "fail", reason: isTimeout(e) ? "timeout" : "error" };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const addr = (v: unknown): string | null => (typeof v === "string" && ADDRESS_RE.test(v) ? v.toLowerCase() : null);
const HASH_RE = /^0x[0-9a-fA-F]+$/;

/** Function names an owner could use against holders (P4-R2, «mint/blacklist/setFee-like»). */
const PRIVILEGED_FN = /^mint|blacklist|blocklist|^set\w*(fee|tax)/i;

/**
 * The privileged function names in a verified ABI, in ABI order, without duplicates. Only state-changing functions
 * count: events, errors and view getters (`minter()`, `isBlacklisted()`, and pre-0.5 ABIs' `constant: true` ones such
 * as `mintingFinished()`) do not.
 */
export function abiFlags(abi: unknown): string[] {
  if (!Array.isArray(abi)) return [];
  const out: string[] = [];
  for (const item of abi) {
    if (!isObj(item) || item.type !== "function" || item.stateMutability === "view" || item.stateMutability === "pure" || item.constant === true) continue;
    const name = str(item.name);
    if (name && PRIVILEGED_FN.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

// --- Blockscout --------------------------------------------------------------------------------------------------------

export type BlockscoutAddress = {
  /** Blockscout answered 404: it has not indexed the address (yet), so its silence proves nothing. */
  notIndexed: boolean;
  isContract: boolean | null;
  verified: boolean;
  creator: string | null;
  creationTx: string | null;
  implementation: string | null;
  isScam: boolean;
};

/** `/api/v2/addresses/{addr}`. A 404 is an address Blockscout never indexed: nothing known against it. */
export async function blockscoutAddress(base: string, address: string): Promise<Section<BlockscoutAddress>> {
  const r = await getJson(`${base}/api/v2/addresses/${address}`);
  if (r.kind === "fail") return unknown(r.reason);
  if (r.kind === "not_found") return ok({ notIndexed: true, isContract: null, verified: false, creator: null, creationTx: null, implementation: null, isScam: false });
  if (!isObj(r.json)) return unknown("error");
  const j = r.json;
  const impls = Array.isArray(j.implementations) ? j.implementations : [];
  const firstImpl = impls.find(isObj);
  const tx = str(j.creation_transaction_hash) ?? str(j.creation_tx_hash);
  return ok({
    notIndexed: false,
    isContract: typeof j.is_contract === "boolean" ? j.is_contract : null,
    verified: j.is_verified === true,
    creator: addr(j.creator_address_hash),
    creationTx: tx && HASH_RE.test(tx) ? tx : null,
    implementation: firstImpl ? addr(firstImpl.address_hash) ?? addr(firstImpl.address) : null,
    isScam: j.is_scam === true,
  });
}

/** The creation transaction's timestamp (ISO). A failed lookup is unknown with its reason, never «no date». */
export async function blockscoutTxTime(base: string, hash: string): Promise<Section<string>> {
  const r = await getJson(`${base}/api/v2/transactions/${hash}`);
  if (r.kind === "fail") return unknown(r.reason);
  if (r.kind !== "ok" || !isObj(r.json)) return unknown("error");
  const ts = str(r.json.timestamp);
  // Blockscout sends microseconds ("…00.000000Z"); keep milliseconds so Date parses it everywhere.
  const t = ts ? Date.parse(ts.replace(/(\.\d{3})\d+/, "$1")) : NaN;
  return Number.isFinite(t) ? ok(new Date(t).toISOString()) : unknown("error");
}

/** The verified ABI from `/api/v2/smart-contracts/{addr}`; any failure (404 included) is unknown with its reason. */
export async function blockscoutAbi(base: string, address: string): Promise<Section<unknown[]>> {
  const r = await getJson(`${base}/api/v2/smart-contracts/${address}`);
  if (r.kind === "fail") return unknown(r.reason);
  return r.kind === "ok" && isObj(r.json) && Array.isArray(r.json.abi) ? ok(r.json.abi) : unknown("error");
}

// --- Sourcify ----------------------------------------------------------------------------------------------------------

const MATCHES = new Set(["match", "exact_match", "perfect", "partial"]);

/** `/v2/contract/{chainId}/{address}?fields=abi`: 404 = not verified there. */
export async function sourcifyContract(base: string, chain: ChainId, address: string): Promise<Section<{ verified: boolean; abi: unknown[] | null }>> {
  const r = await getJson(`${base}/v2/contract/${chain}/${address}?fields=abi`);
  if (r.kind === "fail") return unknown(r.reason);
  if (r.kind === "not_found") return ok({ verified: false, abi: null });
  if (!isObj(r.json)) return unknown("error");
  const j = r.json;
  const verified = [j.match, j.runtimeMatch, j.creationMatch].some((m) => typeof m === "string" && MATCHES.has(m));
  return ok({ verified, abi: verified && Array.isArray(j.abi) ? j.abi : null });
}

// --- DexScreener -------------------------------------------------------------------------------------------------------

export type DexMarket = { pairs: number; liquidityUsd: number | null; priceUsd: string | null; fdv: number | null; topPairUrl: string | null };

const dexUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && (u.hostname === "dexscreener.com" || u.hostname.endsWith(".dexscreener.com")) ? u.href : null;
  } catch {
    return null;
  }
};

/**
 * `/tokens/v1/{slug}/{address}`: the token's pairs. Liquidity is the sum over the pairs; price, FDV and link come from
 * the deepest pair, and the price only when the token is that pair's base token (otherwise it is the other token's).
 */
export async function dexscreenerMarket(source: { base: string; slug: string }, address: string): Promise<Section<DexMarket>> {
  const r = await getJson(`${source.base}/tokens/v1/${source.slug}/${address}`);
  if (r.kind === "fail") return unknown(r.reason);
  if (r.kind === "not_found") return ok({ pairs: 0, liquidityUsd: null, priceUsd: null, fdv: null, topPairUrl: null });
  const list = Array.isArray(r.json) ? r.json : isObj(r.json) && (Array.isArray(r.json.pairs) || r.json.pairs === null) ? (r.json.pairs ?? []) : null;
  if (list === null) return unknown("error");
  const pairs = (list as unknown[]).filter(isObj);
  let top = pairs[0];
  if (top === undefined) return ok({ pairs: 0, liquidityUsd: null, priceUsd: null, fdv: null, topPairUrl: null });
  const liq = (p: Record<string, unknown>) => (isObj(p.liquidity) ? num(p.liquidity.usd) : null);
  let total: number | null = null;
  for (const p of pairs) {
    const l = liq(p);
    if (l !== null) total = (total ?? 0) + l;
    if ((l ?? -1) > (liq(top) ?? -1)) top = p;
  }
  const isBase = isObj(top.baseToken) && addr(top.baseToken.address) === address.toLowerCase();
  const price = str(top.priceUsd);
  return ok({
    pairs: pairs.length,
    liquidityUsd: total,
    priceUsd: isBase && price !== null && num(price) !== null ? price : null,
    fdv: num(top.fdv),
    topPairUrl: dexUrl(top.url),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// RPC

/** Longest contract-declared name/symbol kept, in characters (code points). */
export const MAX_CONTRACT_TEXT = 64;
// Control (Cc) and format (Cf: bidi overrides/isolates, zero-width…) characters: a contract can declare anything.
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

/** Text a contract declares about itself (name, symbol): control/bidi characters stripped, trimmed, capped; null if empty. */
export function contractText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const clean = Array.from(v.replace(CONTROL_OR_FORMAT, "").trim()).slice(0, MAX_CONTRACT_TEXT).join("").trim();
  return clean === "" ? null : clean;
}

/** EIP-1967 `bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)`. */
export const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const OWNER_ABI = [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** A transport failure (the node did not answer) as an unknown reason; null for anything else (a revert, bad data). */
export function rpcFailure(e: unknown): UnknownReason | null {
  if (!(e instanceof BaseError)) return null;
  const hit = e.walk((x) => x instanceof TimeoutError || x instanceof HttpRequestError || x instanceof LimitExceededRpcError);
  if (hit instanceof TimeoutError) return "timeout";
  if (hit instanceof LimitExceededRpcError || (hit instanceof HttpRequestError && hit.status === 429)) return "rate_limited";
  return hit ? "error" : null;
}

export type ChainFacts = { code: Section<{ hasCode: boolean }>; erc20: Section<Erc20Data | null>; proxy: Section<ProxyData>; owner: Section<OwnerData | null> };

const allUnknown = (reason: UnknownReason): ChainFacts => ({ code: unknown(reason), erc20: unknown(reason), proxy: unknown(reason), owner: unknown(reason) });

async function readChainUnbounded(chain: ChainId, address: `0x${string}`): Promise<ChainFacts> {
  const client = chainClient(chain);
  let code: `0x${string}` | undefined;
  try {
    code = await client.getCode({ address });
  } catch (e) {
    return allUnknown(rpcFailure(e) ?? "error");
  }
  if (!code || code === "0x") {
    return { code: ok({ hasCode: false }), erc20: ok(null), proxy: ok({ isProxy: false, implementation: null }), owner: ok(null) };
  }

  const erc20 = (async (): Promise<Section<Erc20Data | null>> => {
    try {
      const [name, symbol, decimals, totalSupply] = await client.multicall({
        contracts: [
          { address, abi: erc20Abi, functionName: "name" },
          { address, abi: erc20Abi, functionName: "symbol" },
          { address, abi: erc20Abi, functionName: "decimals" },
          { address, abi: erc20Abi, functionName: "totalSupply" },
        ],
        allowFailure: true,
      });
      // allowFailure turns a call the node never answered into a per-item failure too: that is unknown, not «no ERC-20».
      for (const r of [decimals, totalSupply]) {
        const reason = r.status === "failure" ? rpcFailure(r.error) : null;
        if (reason) return unknown(reason);
      }
      if (decimals.status !== "success" || typeof decimals.result !== "number") return ok(null);
      if (totalSupply.status !== "success" || typeof totalSupply.result !== "bigint") return ok(null);
      const text = (r: { status: string; result?: unknown }) => (r.status === "success" ? contractText(r.result) : null);
      return ok({ name: text(name), symbol: text(symbol), decimals: decimals.result, totalSupply: totalSupply.result.toString() });
    } catch (e) {
      return unknown(rpcFailure(e) ?? "error");
    }
  })();

  const proxy = (async (): Promise<Section<ProxyData>> => {
    try {
      const slot = await client.getStorageAt({ address, slot: EIP1967_IMPLEMENTATION_SLOT });
      const impl = slot && slot.length >= 42 ? `0x${slot.slice(-40)}`.toLowerCase() : null;
      return impl && impl !== ZERO_ADDRESS ? ok({ isProxy: true, implementation: impl }) : ok({ isProxy: false, implementation: null });
    } catch (e) {
      return unknown(rpcFailure(e) ?? "error");
    }
  })();

  const owner = (async (): Promise<Section<OwnerData | null>> => {
    try {
      const o = addr(await client.readContract({ address, abi: OWNER_ABI, functionName: "owner" }));
      return ok(o === null ? null : { owner: o, renounced: o === ZERO_ADDRESS });
    } catch (e) {
      // Only a real revert (or an empty answer) means there is no owner() to read; any other failure is unknown.
      if (e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError))
        return ok(null);
      return unknown(rpcFailure(e) ?? "error");
    }
  })();

  const [e, p, o] = await Promise.all([erc20, proxy, owner]);
  return { code: ok({ hasCode: true }), erc20: e, proxy: p, owner: o };
}

/** Code, ERC-20 metadata, EIP-1967 implementation and `owner()` from the club's RPC, within one deadline. */
export async function readChain(chain: ChainId, address: `0x${string}`): Promise<ChainFacts> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ChainFacts>((resolve) => {
    timer = setTimeout(() => resolve(allUnknown("timeout")), RPC_DEADLINE_MS);
  });
  try {
    return await Promise.race([readChainUnbounded(chain, address), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
