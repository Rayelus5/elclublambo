import { shortAddress } from "@/lib/auth/wallet";
import { ALIAS_RE } from "./alias";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** "@alias" / "0x12…ab" for the page and share titles; null for a target that is neither. */
export function payTitleName(target: string): string | null {
  if (ADDRESS_RE.test(target)) return shortAddress(target);
  if (ALIAS_RE.test(target)) return `@${target}`;
  return null;
}
