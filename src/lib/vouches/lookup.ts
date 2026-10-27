import { ALIAS_RE } from "@/lib/pay/alias";
import { ADDRESS_RE } from "@/lib/pay/target";

export type VouchLookup = { kind: "empty" } | { kind: "invalid" } | { kind: "address"; address: string } | { kind: "alias"; alias: string };

/**
 * The tool's `?address=`: a 0x address or a Pay alias (with or without "@", any case). Anything starting with 0x is read
 * as an address, so a truncated one is invalid rather than looked up as an alias.
 */
export function parseVouchLookup(raw: string): VouchLookup {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  if (/^0x/i.test(text)) return ADDRESS_RE.test(text) ? { kind: "address", address: text } : { kind: "invalid" };
  const alias = text.replace(/^@/, "").toLowerCase();
  return ALIAS_RE.test(alias) ? { kind: "alias", alias } : { kind: "invalid" };
}
