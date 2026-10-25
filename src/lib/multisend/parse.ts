import { getAddress, keccak256, stringToHex } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { parseAmount, TOKEN_DECIMALS } from "@/lib/payments/amounts";

/** P6-R3: at most this many recipients per send. */
export const MAX_RECIPIENTS = 20;

type Address = `0x${string}`;

/** `id`: the line's identity (lineId), what its progress is keyed by. */
export type ParsedLine = { line: number; to: Address; amount: bigint; id: string };
export type LineIssue = {
  line: number;
  code: "bad_address" | "bad_amount" | "zero_amount" | "too_many_decimals" | "zero_address" | "token_contract" | "too_many";
};
export type ParsedList = { recipients: ParsedLine[]; errors: LineIssue[]; merged: Array<{ to: Address; lines: number[] }>; total: bigint };

/** The address (42 characters), a separator (`,`, `;`, a tab or spaces) and the rest of the line as the amount. */
const LINE_RE = /^(0x[0-9a-fA-F]{40})(?:\s*[,;\t]\s*|\s+)(.*)$/;
const LEAD_RE = /^([^,;\s]+)/;
const HEX40 = /^0x[0-9a-fA-F]{40}$/;
const NUMBER_RE = /^\d+(?:[.,](\d+))?$/;
const ZERO = `0x${"0".repeat(40)}`;

/** All lower case, all upper case, or mixed case with a valid EIP-55 checksum (a wrong checksum is a typo). */
function toAddress(text: string): Address | null {
  if (!HEX40.test(text)) return null;
  const hex = text.slice(2);
  const normalised = getAddress(text.toLowerCase());
  if (hex !== hex.toLowerCase() && hex !== hex.toUpperCase() && normalised !== text) return null;
  return normalised;
}

function parseLineAmount(text: string): LineIssue["code"] | bigint {
  const t = text.trim();
  const n = NUMBER_RE.exec(t);
  if (!n) return "bad_amount";
  if ((n[1] ?? "").length > TOKEN_DECIMALS.USDC) return "too_many_decimals";
  const units = parseAmount(t, "USDC");
  if (units === null) return "bad_amount";
  return units === 0n ? "zero_amount" : units;
}

/**
 * The pasted list (P6-R3): one recipient per non-empty line; amounts in USDC base units (6 decimals, decimal comma or
 * point). A line has at most one issue. The 21st non-empty line and later ones are `too_many`. The same address on
 * several lines (compared in lower case) is one recipient with the sum, listed in `merged`. Pure.
 */
export function parseRecipients(text: string, chain: ChainId): ParsedList {
  const usdc = NETWORKS[chain].usdc.toLowerCase();
  const errors: LineIssue[] = [];
  const byAddress = new Map<string, { row: ParsedLine; lines: number[] }>();
  let count = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "") return;
    count += 1;
    if (count > MAX_RECIPIENTS) return void errors.push({ line, code: "too_many" });
    const m = LINE_RE.exec(trimmed);
    const to = toAddress(m ? m[1]! : (LEAD_RE.exec(trimmed)?.[1] ?? ""));
    if (!to) return void errors.push({ line, code: "bad_address" });
    if (to.toLowerCase() === ZERO) return void errors.push({ line, code: "zero_address" });
    if (to.toLowerCase() === usdc) return void errors.push({ line, code: "token_contract" });
    const amount = m ? parseLineAmount(m[2]!) : "bad_amount";
    if (typeof amount !== "bigint") return void errors.push({ line, code: amount });
    const key = to.toLowerCase();
    const seen = byAddress.get(key);
    if (seen) {
      seen.row.amount += amount;
      seen.lines.push(line);
    } else {
      byAddress.set(key, { row: { line, to, amount, id: "" }, lines: [line] });
    }
  });
  const entries = [...byAddress.values()];
  const seen = new Map<string, number>();
  for (const { row } of entries) {
    const base = lineId(row.to, row.amount, 0);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    row.id = lineId(row.to, row.amount, n);
  }
  return {
    recipients: entries.map((e) => e.row),
    errors,
    merged: entries.filter((e) => e.lines.length > 1).map((e) => ({ to: e.row.to, lines: e.lines })),
    total: entries.reduce((sum, e) => sum + e.row.amount, 0n),
  };
}

/**
 * A line's identity (C3): recipient in lower case, amount in base units, and its occurrence among identical lines. The
 * parser already sums one address's lines, so the occurrence is 0 for every line it returns today.
 */
export function lineId(to: string, amount: bigint, occurrence: number): string {
  return `${to.toLowerCase()}:${amount}:${occurrence}`;
}

/** A stable hash of the list's line identities (sorted, so the order does not matter) and the chain: the progress key. */
export function listKey(chain: ChainId, recipients: readonly Pick<ParsedLine, "id">[]): string {
  const text = `${chain}|${recipients.map((r) => r.id).sort().join("|")}`;
  return keccak256(stringToHex(text)).slice(2, 34);
}
