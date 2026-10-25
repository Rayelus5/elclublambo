"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getPublicSession } from "@/lib/auth/public-session";
import { hitRateLimit } from "@/lib/rate-limit";
import { hitIpRateLimit } from "@/lib/rate-limit/ip";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { chainClient } from "@/lib/payments/chain-client";
import { isVouchChain, VOUCH_SCHEMA_UID, vouchChain, type VouchChainId } from "./eas";
import type { RefreshVouchError, VouchError } from "./types";
import { readAttestation, verifyVouchTx, type OnchainAttestation } from "./verify";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

type TxInput = { chainId: number; txHash: string };
type Fail<E> = { ok: false; error: E };
const fail = <E>(error: E): Fail<E> => ({ ok: false, error });

/**
 * The tool (literal internal paths) and every Pay page (the recipient's may be reached by alias or address). A route
 * pattern names the file path, route group included: the page's cache tag is /(public)/[lang]/pay/[target]/page.
 */
function revalidateVouches() {
  for (const lang of ["es", "en"]) revalidatePath(`/${lang}/tools/vouches`);
  revalidatePath("/(public)/[lang]/pay/[target]", "page");
}

/** Only the hash and the chain come from the client: the chain must be this deployment's Base. */
function parseTx(input: TxInput): { chain: VouchChainId; hash: `0x${string}` } | VouchError {
  if (!input || typeof input !== "object" || typeof input.txHash !== "string" || !HEX32.test(input.txHash.trim())) return "invalid_input";
  if (!isVouchChain(input.chainId) || input.chainId !== vouchChain()) return "chain_unsupported";
  return { chain: input.chainId, hash: input.txHash.trim().toLowerCase() as `0x${string}` };
}

/** Session, vouch_write hit (JWT client, F5-R2) and the on-chain check, shared by recording and revoking. */
async function verified(input: TxInput, expect: "attest" | "revoke"): Promise<{ attestation: OnchainAttestation; wallet: string; chain: VouchChainId; hash: `0x${string}` } | VouchError> {
  const tx = parseTx(input);
  if (typeof tx === "string") return tx;
  const session = await getPublicSession();
  if (!session) return "not_authenticated";
  const limit = await hitRateLimit(await createServerClient(), "vouch_write");
  if (limit === "rate_limited") return "rate_limited";
  if (limit !== "ok") return "unknown";
  const r = await verifyVouchTx({ chain: tx.chain, txHash: tx.hash, expect, attester: session.wallet });
  if (r.status === "pending") return "pending";
  if (r.status === "error") return r.code;
  return { attestation: r.attestation, wallet: session.wallet, chain: tx.chain, hash: tx.hash };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Records a vouch the session's wallet just signed. Everything stored (kind, recipient, attester, times) is read from
 * `getAttestation`; the client only sends the hash. The same hash twice answers `already: true` (Review Focus 4).
 */
export async function recordVouchAction(input: TxInput): Promise<{ ok: true; uid: string; already: boolean } | Fail<VouchError>> {
  const v = await verified(input, "attest");
  if (typeof v === "string") return fail(v);
  const { attestation: a } = v;
  if (same(a.recipient, v.wallet)) return fail("self_vouch");
  if (a.kind === null) return fail("not_a_vouch");

  const { data, error } = await createAdminClient().rpc("record_vouch", {
    p_chain_id: v.chain,
    p_uid: a.uid,
    p_attester: a.attester,
    p_recipient: a.recipient,
    p_kind: a.kind,
    p_tx_hash: v.hash,
    p_attested_at: a.time.toISOString(),
    p_revoked_at: iso(a.revokedAt),
  });
  if (error) {
    if (error.message === "self_vouch" || error.message === "invalid_input") return fail(error.message);
    console.error("[vouches] record failed", safeError(error.message));
    return fail("unknown");
  }
  const res = data as { already?: unknown; uid?: unknown } | null;
  if (!res || typeof res !== "object" || typeof res.uid !== "string" || typeof res.already !== "boolean") return fail("unknown");
  revalidateVouches();
  return { ok: true, uid: res.uid, already: res.already };
}

/** Marks revoked a stored vouch whose revocation the session's wallet just signed (EAS lets only the attester revoke). */
export async function recordRevocationAction(input: TxInput): Promise<{ ok: true; uid: string } | Fail<VouchError>> {
  const v = await verified(input, "revoke");
  if (typeof v === "string") return fail(v);
  const { attestation: a } = v;
  const db = createAdminClient();
  const { data: attester, error: readErr } = await db.rpc("vouch_attester", { p_uid: a.uid });
  if (readErr) {
    console.error("[vouches] attester read failed", safeError(readErr.message));
    return fail("unknown");
  }
  if (typeof attester !== "string") return fail("not_found");
  if (!same(attester, v.wallet)) return fail("wrong_attester");

  const { data, error } = await db.rpc("apply_vouch_state", { p_uid: a.uid, p_state: "revoked", p_revoked_at: iso(a.revokedAt) });
  if (error) {
    console.error("[vouches] revoke failed", safeError(error.message));
    return fail("unknown");
  }
  if (data === "not_found") return fail("not_found");
  revalidateVouches();
  return { ok: true, uid: a.uid };
}

/**
 * «Actualizar» (P5-R5b, Review Focus 3): re-reads a stored vouch on chain. Revoked elsewhere -> revoked_at; a uid the
 * chain no longer knows -> the row is deleted once it is 10 minutes old (younger, its current state is answered). No session; vouch_refresh by IP, failing open like the checker page.
 */
export async function refreshVouchAction(uid: string): Promise<{ ok: true; state: "active" | "revoked" | "removed" } | Fail<RefreshVouchError>> {
  if (typeof uid !== "string" || !HEX32.test(uid.trim())) return fail("invalid_input");
  const id = uid.trim().toLowerCase() as `0x${string}`;
  if ((await hitIpRateLimit("vouch_refresh", await headers())) === "rate_limited") return fail("rate_limited");

  const db = createAdminClient();
  const { data: attester, error: readErr } = await db.rpc("vouch_attester", { p_uid: id });
  if (readErr) {
    console.error("[vouches] attester read failed", safeError(readErr.message));
    return fail("unknown");
  }
  if (typeof attester !== "string") return fail("not_found");

  // «Removed» deletes the row: an RPC on another chain (EAS sits at the same predeploy on every OP Stack chain) would
  // read every uid as zero, so the chain id is checked first, as verifyVouchTx does.
  const chain = vouchChain();
  let onchain: OnchainAttestation | null;
  try {
    const client = chainClient(chain);
    const rpcChain = await client.getChainId();
    if (rpcChain !== chain) {
      console.error(`[vouches] RPC chain mismatch: expected ${chain}, got ${rpcChain}`);
      return fail("rpc_unavailable");
    }
    onchain = await readAttestation(chain, id, client);
  } catch (e) {
    console.error("[vouches] attestation read failed", safeError(e));
    return fail("rpc_unavailable");
  }
  if (onchain && onchain.schema.toLowerCase() !== VOUCH_SCHEMA_UID.toLowerCase()) {
    console.error("[vouches] stored uid has another schema on chain", id);
    return fail("not_found");
  }
  const state = onchain === null ? "removed" : onchain.revokedAt ? "revoked" : "active";
  const { data, error } = await db.rpc("apply_vouch_state", { p_uid: id, p_state: state, p_revoked_at: iso(onchain?.revokedAt ?? null) });
  if (error) {
    console.error("[vouches] refresh failed", safeError(error.message));
    return fail("unknown");
  }
  if (data === "not_found") return fail("not_found");
  // A row younger than 10 minutes is never removed (a lagging RPC node may read zero): the RPC then answers its current
  // state, «active» or «revoked», and writes nothing.
  if (data !== "active" && data !== "revoked" && data !== "removed") {
    console.error("[vouches] unexpected refresh answer", safeError(String(data)));
    return fail("unknown");
  }
  if (data === state && state !== "active") revalidateVouches();
  return { ok: true, state: data };
}
