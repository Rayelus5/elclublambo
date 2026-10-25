import "server-only";
import { cacheLife } from "next/cache";
import { parseEventLogs, zeroHash, type PublicClient } from "viem";
import { chainClient } from "@/lib/payments/chain-client";
import { decodeVouchData, easAddresses, VOUCH_SCHEMA_UID, type VouchChainId } from "./eas";
import { easAbi, schemaRegistryAbi } from "./eas-abi";

export type OnchainAttestation = {
  uid: `0x${string}`;
  schema: `0x${string}`;
  attester: `0x${string}`;
  recipient: `0x${string}`;
  kind: number | null;
  time: Date;
  revokedAt: Date | null;
  revocable: boolean;
};

export type VerifyVouchResult =
  | { status: "ok"; attestation: OnchainAttestation }
  | { status: "pending" }
  | { status: "error"; code: "tx_not_found" | "tx_failed" | "not_a_vouch" | "wrong_attester" | "rpc_unavailable" };

const err = (code: Extract<VerifyVouchResult, { status: "error" }>["code"]): VerifyVouchResult => ({ status: "error", code });
const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const toDate = (seconds: bigint) => new Date(Number(seconds) * 1000);

class NotFound extends Error {}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TransactionNotFoundError" || name === "TransactionReceiptNotFoundError";
}

/** The attestation as the chain has it, or null when EAS does not know the uid (zero uid). Throws on RPC errors. */
export async function readAttestation(chain: VouchChainId, uid: `0x${string}`, client: PublicClient = chainClient(chain)): Promise<OnchainAttestation | null> {
  const a = await client.readContract({ address: easAddresses().eas, abi: easAbi, functionName: "getAttestation", args: [uid] });
  if (a.uid === zeroHash) return null;
  return {
    uid: a.uid,
    schema: a.schema,
    attester: a.attester,
    recipient: a.recipient,
    kind: decodeVouchData(a.data),
    time: toDate(a.time),
    revokedAt: a.revocationTime === 0n ? null : toDate(a.revocationTime),
    revocable: a.revocable,
  };
}

/**
 * Checks that a transaction hash is one of our vouches: mined and successful, with an Attested/Revoked event emitted by
 * EAS for our schema, signed by `attester`. Everything stored comes from `getAttestation`, never from the client or
 * the log. Never throws.
 */
export async function verifyVouchTx(
  input: { chain: VouchChainId; txHash: `0x${string}`; expect: "attest" | "revoke"; attester: string },
  injected?: PublicClient,
): Promise<VerifyVouchResult> {
  try {
    // Built inside the try: a throwing chainClient must become rpc_unavailable, not an exception.
    const client = injected ?? chainClient(input.chain);
    const rpcChain = await client.getChainId();
    if (rpcChain !== input.chain) {
      console.error(`[vouches] RPC chain mismatch: expected ${input.chain}, got ${rpcChain}`);
      return err("rpc_unavailable");
    }

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: input.txHash });
    } catch (e) {
      if (!isNotFound(e)) throw e;
      // Broadcast but not mined yet: pending. Unknown to the node: not found.
      try {
        await client.getTransaction({ hash: input.txHash });
      } catch (e2) {
        if (isNotFound(e2)) throw new NotFound();
        throw e2;
      }
      return { status: "pending" };
    }
    if (receipt.status !== "success") return err("tx_failed");

    const eventName = input.expect === "attest" ? "Attested" : "Revoked";
    const { eas } = easAddresses();
    const event = parseEventLogs({ abi: easAbi, eventName, logs: receipt.logs, strict: true }).find(
      (l) => same(l.address, eas) && l.args.schemaUID === VOUCH_SCHEMA_UID,
    );
    if (!event) return err("not_a_vouch");
    if (!same(event.args.attester, input.attester)) return err("wrong_attester");

    const attestation = await readAttestation(input.chain, event.args.uid, client);
    if (
      !attestation ||
      !same(attestation.uid, event.args.uid) ||
      !same(attestation.schema, VOUCH_SCHEMA_UID) ||
      !same(attestation.attester, input.attester)
    ) {
      return err("not_a_vouch");
    }
    if (input.expect === "revoke" && attestation.revokedAt === null) return err("not_a_vouch");
    return { status: "ok", attestation };
  } catch (e) {
    if (e instanceof NotFound) return err("tx_not_found");
    return err("rpc_unavailable");
  }
}

/** Whether our schema is registered in the chain's SchemaRegistry. Throws when the RPC fails (the caller decides). */
export async function isVouchSchemaRegistered(chain: VouchChainId, client: PublicClient = chainClient(chain)): Promise<boolean> {
  const s = await client.readContract({ address: easAddresses().registry, abi: schemaRegistryAbi, functionName: "getSchema", args: [VOUCH_SCHEMA_UID] });
  return s.uid !== zeroHash;
}

/**
 * Cached for an hour once registered; an unregistered schema only lives a few seconds, so registering it by hand shows
 * up almost at once and a negative is never kept long (P5-R3). `cacheLife` is called in one branch per invocation.
 * An RPC failure throws and nothing is cached.
 */
async function registeredCached(chain: VouchChainId): Promise<boolean> {
  "use cache";
  const registered = await isVouchSchemaRegistered(chain);
  if (registered) cacheLife("hours");
  else cacheLife("seconds");
  return registered;
}

/** `isVouchSchemaRegistered` through the cache above. Throws when the RPC fails; callers map any error to "unknown". Request time only. */
export async function getVouchSchemaRegistered(chain: VouchChainId): Promise<boolean> {
  return registeredCached(chain);
}
