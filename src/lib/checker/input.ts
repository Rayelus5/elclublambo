import { isChainId, type ChainId } from "@/lib/economy/networks";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** Looks like an attempt at an address (0x + letters/digits, no dots or slashes): judged as one, never as a link. */
const ADDRESS_LIKE = /^0x[0-9a-zA-Z]*$/;
/** The longest text the form takes (the link analyser caps lower anyway). */
export const MAX_QUERY_LENGTH = 2048;

export type CheckerInput =
  | { kind: "empty" }
  | { kind: "token"; chain: ChainId; address: `0x${string}` }
  | { kind: "link"; text: string }
  | { kind: "error"; error: "invalid_address" | "invalid_chain" };

export function looksLikeAddress(text: string): boolean {
  return ADDRESS_LIKE.test(text.trim());
}

/** A URL search param as one string ("" when missing; the first value when repeated). */
export function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * What the checker's `?q=…&chain=…` asks for. An address needs a chain of this build (the first one when none is given);
 * anything that is not address-like is a link, judged later by the link analyser. Pure.
 */
export function classifyInput(q: string, chainParam: string, chains: readonly ChainId[]): CheckerInput {
  const text = q.trim();
  if (text === "") return { kind: "empty" };
  if (!looksLikeAddress(text)) return { kind: "link", text: text.slice(0, MAX_QUERY_LENGTH) };
  if (!ADDRESS_RE.test(text)) return { kind: "error", error: "invalid_address" };
  let chain: ChainId | undefined = chains[0];
  if (chainParam !== "") {
    const n = /^\d{1,7}$/.test(chainParam) ? Number(chainParam) : NaN;
    chain = isChainId(n) && chains.includes(n) ? n : undefined;
  }
  if (chain === undefined) return { kind: "error", error: "invalid_chain" };
  return { kind: "token", chain, address: text as `0x${string}` };
}
