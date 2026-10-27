// Lock state of a channel gated by donations (channel_lock_state / locked_channels) and the Spanish copy that
// describes it. Pure: safe to import from client components.

import { parseAmount } from "@/lib/payments/amounts";
import { formatUsd } from "@/lib/treasury/format";
import type { ChannelKind } from "@/lib/channels/tree";

export type GateScope = "view" | "post";

/** One failing gate on the path to the channel. `channelId` is null only for an answer without `requirements`. */
export type LockRequirement = {
  channelId: string | null;
  scope: GateScope;
  /** Minimum the member has to have donated, in usd6 (USD with 6 decimals). */
  minDonatedUsd6: bigint;
};

export type LockState = {
  scope: GateScope;
  /** Top-level rule = the outermost failing gate (same as requirements[0]). */
  minDonatedUsd6: bigint | null;
  myDonatedUsd6: bigint;
  name: string;
  kind: ChannelKind;
  parentId: string | null;
  /** EVERY failing gate of `scope` on the path, outermost first. The member must meet all of them. */
  requirements: LockRequirement[];
};

const KINDS: ChannelKind[] = ["category", "forum", "text"];

/** numeric(78,0) travels as text in jsonb; a plain integer number is accepted too. */
function bigintOrNull(v: unknown): bigint | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v === "string" && /^\d{1,78}$/.test(v)) return BigInt(v);
  return null;
}

/** The jsonb of channel_lock_state -> a typed state, or null when it is null or malformed. */
export function parseLockState(raw: unknown): LockState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.scope !== "view" && r.scope !== "post") return null;
  if (typeof r.name !== "string" || !KINDS.includes(r.kind as ChannelKind)) return null;
  const scope = r.scope;
  const minDonatedUsd6 = bigintOrNull(r.minDonatedUsd6);
  const myDonatedUsd6 = bigintOrNull(r.myDonatedUsd6);
  if (minDonatedUsd6 === null || myDonatedUsd6 === null) return null;

  let requirements: LockRequirement[];
  if (Array.isArray(r.requirements)) {
    requirements = [];
    for (const q of r.requirements as Array<Record<string, unknown>>) {
      const min = bigintOrNull(q?.minDonatedUsd6);
      if (min === null) continue;
      requirements.push({
        channelId: typeof q.channelId === "string" ? q.channelId : null,
        scope: q.scope === "post" ? "post" : "view",
        minDonatedUsd6: min,
      });
    }
    if (requirements.length === 0) return null;
  } else {
    requirements = [{ channelId: null, scope, minDonatedUsd6 }];
  }
  return {
    scope,
    minDonatedUsd6,
    myDonatedUsd6,
    name: r.name,
    kind: r.kind as ChannelKind,
    parentId: typeof r.parentId === "string" ? r.parentId : null,
    requirements,
  };
}

/** "Canal para quien ha donado al menos 10 USD." */
export function requirementText(rule: { minDonatedUsd6: bigint | null }): string {
  return rule.minDonatedUsd6 === null
    ? "Canal con candado."
    : `Canal para quien ha donado al menos ${formatUsd(rule.minDonatedUsd6)}.`;
}

/** "Llevas 9,99 USD." */
export function lockSituationText(state: Pick<LockState, "myDonatedUsd6">): string {
  return `Llevas ${formatUsd(state.myDonatedUsd6)}.`;
}

/** "Canal para quien ha donado al menos 10 USD. Llevas 9,99 USD." (the outermost failing gate). */
export function lockText(state: LockState): string {
  return `${requirementText(state)} ${lockSituationText(state)}`;
}

/** "12,5" / "12.5" -> usd6 (12_500_000n) with bigint math. Null when malformed, negative or past 6 decimals. */
export function usdToUsd6(text: string): bigint | null {
  return parseAmount(text, "USDC");
}
