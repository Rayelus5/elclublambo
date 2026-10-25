import "server-only";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVouchChain, vouchChain, type VouchChainId } from "./eas";
import type { GivenVouch, VouchesSummary, VouchItem } from "./types";
import { getVouchSchemaRegistered } from "./verify";

type Raw = Record<string, unknown>;

const isRaw = (v: unknown): v is Raw => !!v && typeof v === "object";
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

function toItem(r: unknown): VouchItem | null {
  if (!isRaw(r)) return null;
  const { uid, attester, attestedAt, txHash } = r;
  const kind = int(r.kind);
  if (typeof uid !== "string" || typeof attester !== "string" || typeof attestedAt !== "string" || typeof txHash !== "string") return null;
  if (kind === null || !isVouchChain(r.chainId)) return null;
  return { uid, chainId: r.chainId, kind, attester, attesterAlias: str(r.attesterAlias), attestedAt, txHash };
}

function toGiven(r: unknown): GivenVouch | null {
  if (!isRaw(r)) return null;
  const { uid, recipient, attestedAt } = r;
  const kind = int(r.kind);
  if (typeof uid !== "string" || typeof recipient !== "string" || typeof attestedAt !== "string") return null;
  if (kind === null || !isVouchChain(r.chainId)) return null;
  return { uid, chainId: r.chainId, kind, recipient, recipientAlias: str(r.recipientAlias), attestedAt };
}

const present = <T>(v: T | null): v is T => v !== null;

/** Received vouches of an address (service role, the Pay alias joined in SQL). Throws on a read error. */
export async function getVouchesFor(recipient: string): Promise<VouchesSummary> {
  const { data, error } = await createAdminClient().rpc("vouches_for", { p_recipient: recipient.toLowerCase() });
  if (error) {
    console.error("[vouches] vouches_for failed", safeError(error.message));
    throw new Error("vouches_for read failed");
  }
  const raw = isRaw(data) ? data : {};
  const counts = (Array.isArray(raw.counts) ? raw.counts : [])
    .map((c) => (isRaw(c) && int(c.kind) !== null && int(c.attesters) !== null ? { kind: c.kind as number, attesters: c.attesters as number } : null))
    .filter(present);
  return {
    total: int(raw.total) ?? 0,
    counts,
    items: (Array.isArray(raw.items) ? raw.items : []).map(toItem).filter(present),
  };
}

/** The newest non-revoked vouches an address gave, with kind and recipient. Throws on a read error. */
export async function getVouchesGivenBy(attester: string): Promise<GivenVouch[]> {
  const { data, error } = await createAdminClient().rpc("vouches_given_by", { p_attester: attester.toLowerCase() });
  if (error) {
    console.error("[vouches] vouches_given_by failed", safeError(error.message));
    throw new Error("vouches_given_by read failed");
  }
  return (Array.isArray(data) ? data : []).map(toGiven).filter(present);
}

/** This deployment's Base chain and whether our schema is registered there; `null` when the RPC is down. Request time only. */
export async function getVouchAvailability(): Promise<{ chainId: VouchChainId; registered: boolean | null }> {
  const chainId = vouchChain();
  try {
    return { chainId, registered: await getVouchSchemaRegistered(chainId) };
  } catch (e) {
    console.error("[vouches] schema check failed", safeError(e));
    return { chainId, registered: null };
  }
}
