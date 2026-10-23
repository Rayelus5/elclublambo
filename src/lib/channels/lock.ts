// Lock state of a DAO-gated channel (channel_lock_state / locked_channels) and the Spanish copy that describes it.
// Pure: safe to import from client components.

import { isLegacyChainId, LEGACY_NETWORKS } from "@/lib/legacy/linea";
import { formatBps, formatUsdc } from "@/lib/treasury/format";
import type { ChannelKind } from "@/lib/channels/tree";

export type GateScope = "view" | "post";

/** One failing gate on the path to the channel. `channelId` is null only for a pre-`requirements` RPC answer. */
export type LockRequirement = {
  channelId: string | null;
  scope: GateScope;
  minShareBps: number | null;
  minNetUsdc: bigint | null;
};

export type LockState = {
  scope: GateScope;
  /** Top-level rule = the outermost failing gate (same as requirements[0]). */
  minShareBps: number | null;
  minNetUsdc: bigint | null;
  myShareBps: number;
  myNet: bigint;
  chainId: number;
  name: string;
  kind: ChannelKind;
  parentId: string | null;
  /** EVERY failing gate of `scope` on the path, outermost first. The member must meet all of them. */
  requirements: LockRequirement[];
};

const KINDS: ChannelKind[] = ["category", "forum", "text"];

function bigintOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  try {
    return BigInt(typeof v === "number" ? Math.trunc(v) : String(v));
  } catch {
    return null;
  }
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** The jsonb of channel_lock_state -> a typed state, or null when it is null or malformed. */
export function parseLockState(raw: unknown): LockState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.scope !== "view" && r.scope !== "post") return null;
  if (typeof r.name !== "string" || !KINDS.includes(r.kind as ChannelKind)) return null;
  const scope = r.scope;
  const minShareBps = intOrNull(r.minShareBps);
  const minNetUsdc = bigintOrNull(r.minNetUsdc);
  const requirements: LockRequirement[] = Array.isArray(r.requirements)
    ? (r.requirements as Array<Record<string, unknown>>).map((q) => ({
        channelId: typeof q.channelId === "string" ? q.channelId : null,
        scope: q.scope === "post" ? "post" : "view",
        minShareBps: intOrNull(q.minShareBps),
        minNetUsdc: bigintOrNull(q.minNetUsdc),
      }))
    : [{ channelId: null, scope, minShareBps, minNetUsdc }];
  return {
    scope,
    minShareBps,
    minNetUsdc,
    myShareBps: intOrNull(r.myShareBps) ?? 0,
    myNet: bigintOrNull(r.myNet) ?? 0n,
    chainId: typeof r.chainId === "number" ? r.chainId : 0,
    name: r.name,
    kind: r.kind as ChannelKind,
    parentId: typeof r.parentId === "string" ? r.parentId : null,
    requirements,
  };
}

/** "Necesitas 1 % de la DAO o 100 USDC aportados": only the rules that are set, joined with "o". */
export function requirementText(rule: { minShareBps: number | null; minNetUsdc: bigint | null }): string {
  const parts: string[] = [];
  if (rule.minShareBps !== null) parts.push(`${formatBps(rule.minShareBps)} de la DAO`);
  if (rule.minNetUsdc !== null) parts.push(`${formatUsdc(rule.minNetUsdc)} aportados`);
  return `Necesitas ${parts.join(" o ")}`;
}

/** Requirement of the outermost failing gate (the top-level fields of the state). */
export function lockRequirementText(state: LockState): string {
  return requirementText(state);
}

/** "Tu situación: 0,2 % · 20 USDC aportados en Linea Sepolia" */
export function lockSituationText(state: LockState, chainName: string): string {
  return `Tu situación: ${formatBps(state.myShareBps)} · ${formatUsdc(state.myNet)} aportados en ${chainName}`;
}

/** Name of the network the state was measured on (the lock state's own chain, not a hard-coded one). */
export function lockChainName(state: LockState): string {
  return isLegacyChainId(state.chainId) ? LEGACY_NETWORKS[state.chainId].name : "la red activa";
}

const GATE_PERCENT = /^(\d+)(?:[.,](\d{1,2}))?$/;

/** "2,5" / "2.5" / "0,05" -> basis points. Null when malformed, over 100 % or with more than 2 decimals. */
export function gatePercentToBps(text: string): number | null {
  const m = GATE_PERCENT.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(bps) && bps <= 10_000 ? bps : null;
}
