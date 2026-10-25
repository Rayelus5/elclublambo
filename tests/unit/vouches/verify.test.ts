import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, zeroAddress, zeroHash, type PublicClient } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: vi.fn() }));

import { EAS_ADDRESS, encodeVouchData, VOUCH_SCHEMA_UID } from "@/lib/vouches/eas";
import { easAbi } from "@/lib/vouches/eas-abi";
import { isVouchSchemaRegistered, readAttestation, verifyVouchTx } from "@/lib/vouches/verify";

const CHAIN = 84532 as const;
const ATTESTER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const FAKE_EAS = "0x1111111111111111111111111111111111111111";
const UID = `0x${"ab".repeat(32)}` as `0x${string}`;
const OTHER_SCHEMA = `0x${"cd".repeat(32)}` as `0x${string}`;
const HASH = `0x${"11".repeat(32)}` as `0x${string}`;

function eventLog(o: { name?: "Attested" | "Revoked"; address?: string; schema?: `0x${string}`; attester?: string }) {
  const name = o.name ?? "Attested";
  return {
    address: o.address ?? EAS_ADDRESS,
    logIndex: 0,
    topics: encodeEventTopics({
      abi: easAbi,
      eventName: name,
      args: { recipient: RECIPIENT, attester: (o.attester ?? ATTESTER) as `0x${string}`, schemaUID: o.schema ?? VOUCH_SCHEMA_UID },
    }),
    data: encodeAbiParameters([{ type: "bytes32" }], [UID]),
  };
}

const att = (over: Partial<{ uid: `0x${string}`; schema: `0x${string}`; time: bigint; revocationTime: bigint; attester: string; data: `0x${string}` }> = {}) => ({
  uid: UID,
  schema: VOUCH_SCHEMA_UID,
  time: 1_700_000_000n,
  expirationTime: 0n,
  revocationTime: 0n,
  refUID: zeroHash,
  recipient: RECIPIENT,
  attester: ATTESTER,
  revocable: true,
  data: encodeVouchData(2),
  ...over,
});

function notFound(name: string) {
  return Object.assign(new Error(name), { name });
}

function client(o: {
  chainId?: number;
  receipt?: unknown;
  tx?: unknown;
  attestation?: ReturnType<typeof att>;
  readError?: Error;
}) {
  const c = {
    getChainId: vi.fn(async () => o.chainId ?? CHAIN),
    getTransactionReceipt: vi.fn(async () => {
      if (o.receipt instanceof Error) throw o.receipt;
      return o.receipt;
    }),
    getTransaction: vi.fn(async () => {
      if (o.tx instanceof Error) throw o.tx;
      return o.tx ?? {};
    }),
    readContract: vi.fn(async () => {
      if (o.readError) throw o.readError;
      return o.attestation ?? att();
    }),
  };
  return c as unknown as PublicClient;
}

const okReceipt = (logs: unknown[]) => ({ status: "success", logs, blockNumber: 10n });
const attest = (c: PublicClient, attester: string = ATTESTER) => verifyVouchTx({ chain: CHAIN, txHash: HASH, expect: "attest", attester }, c);

describe("verifyVouchTx", () => {
  it("accepts an attestation and takes the kind from getAttestation, not from the log", async () => {
    const c = client({ receipt: okReceipt([eventLog({})]), attestation: att({ data: encodeVouchData(3) }) });
    const r = await attest(c);
    expect(r).toMatchObject({ status: "ok", attestation: { uid: UID, attester: ATTESTER, recipient: RECIPIENT, kind: 3, revokedAt: null, revocable: true } });
    if (r.status === "ok") expect(r.attestation.time).toEqual(new Date(1_700_000_000_000));
  });

  it("matches the attester case-insensitively", async () => {
    const c = client({ receipt: okReceipt([eventLog({})]) });
    expect((await attest(c, ATTESTER.toLowerCase())).status).toBe("ok");
  });

  it("rejects an event of another schema", async () => {
    const c = client({ receipt: okReceipt([eventLog({ schema: OTHER_SCHEMA })]) });
    expect(await attest(c)).toEqual({ status: "error", code: "not_a_vouch" });
  });

  it("rejects an event emitted by another address that imitates it", async () => {
    const c = client({ receipt: okReceipt([eventLog({ address: FAKE_EAS })]) });
    expect(await attest(c)).toEqual({ status: "error", code: "not_a_vouch" });
  });

  it("rejects a receipt without events", async () => {
    const c = client({ receipt: okReceipt([]) });
    expect(await attest(c)).toEqual({ status: "error", code: "not_a_vouch" });
  });

  it("rejects a revocation event when an attestation was expected", async () => {
    const c = client({ receipt: okReceipt([eventLog({ name: "Revoked" })]) });
    expect(await attest(c)).toEqual({ status: "error", code: "not_a_vouch" });
  });

  it("rejects another attester", async () => {
    const c = client({ receipt: okReceipt([eventLog({ attester: OTHER })]) });
    expect(await attest(c)).toEqual({ status: "error", code: "wrong_attester" });
  });

  it("rejects when the chain no longer knows the uid", async () => {
    const c = client({ receipt: okReceipt([eventLog({})]), attestation: att({ uid: zeroHash }) });
    expect(await attest(c)).toEqual({ status: "error", code: "not_a_vouch" });
  });

  it("rejects when the stored attestation has another schema", async () => {
    const c = client({ receipt: okReceipt([eventLog({})]), attestation: att({ schema: OTHER_SCHEMA }) });
    expect(await attest(c)).toEqual({ status: "error", code: "not_a_vouch" });
  });

  it("rejects a reverted transaction", async () => {
    const c = client({ receipt: { status: "reverted", logs: [], blockNumber: 10n } });
    expect(await attest(c)).toEqual({ status: "error", code: "tx_failed" });
  });

  it("is pending while the transaction is known but not mined", async () => {
    const c = client({ receipt: notFound("TransactionReceiptNotFoundError"), tx: { hash: HASH } });
    expect(await attest(c)).toEqual({ status: "pending" });
  });

  it("is tx_not_found when the node knows nothing of the hash", async () => {
    const c = client({ receipt: notFound("TransactionReceiptNotFoundError"), tx: notFound("TransactionNotFoundError") });
    expect(await attest(c)).toEqual({ status: "error", code: "tx_not_found" });
  });

  it("is rpc_unavailable on a chain id mismatch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client({ chainId: 8453, receipt: okReceipt([eventLog({})]) });
    expect(await attest(c)).toEqual({ status: "error", code: "rpc_unavailable" });
  });

  it("is rpc_unavailable when the node fails, and never throws", async () => {
    const c = client({ receipt: new Error("boom") });
    expect(await attest(c)).toEqual({ status: "error", code: "rpc_unavailable" });
  });

  describe("revoke", () => {
    const revoke = (c: PublicClient) => verifyVouchTx({ chain: CHAIN, txHash: HASH, expect: "revoke", attester: ATTESTER }, c);

    it("accepts a revocation that getAttestation already shows", async () => {
      const c = client({ receipt: okReceipt([eventLog({ name: "Revoked" })]), attestation: att({ revocationTime: 1_700_000_100n }) });
      const r = await revoke(c);
      expect(r.status).toBe("ok");
      if (r.status === "ok") expect(r.attestation.revokedAt).toEqual(new Date(1_700_000_100_000));
    });

    it("rejects a revocation that getAttestation does not show yet", async () => {
      const c = client({ receipt: okReceipt([eventLog({ name: "Revoked" })]) });
      expect(await revoke(c)).toEqual({ status: "error", code: "not_a_vouch" });
    });
  });
});

describe("readAttestation", () => {
  it("returns null for the zero uid", async () => {
    expect(await readAttestation(CHAIN, UID, client({ attestation: att({ uid: zeroHash }) }))).toBeNull();
  });
  it("maps kind to null when the data is not a uint8", async () => {
    const r = await readAttestation(CHAIN, UID, client({ attestation: att({ data: "0x" }) }));
    expect(r?.kind).toBeNull();
  });
});

describe("isVouchSchemaRegistered", () => {
  const reg = (uid: `0x${string}`) => ({ readContract: vi.fn(async () => ({ uid, resolver: zeroAddress, revocable: true, schema: "" })) }) as unknown as PublicClient;
  it("is false when getSchema returns the zero uid", async () => {
    expect(await isVouchSchemaRegistered(CHAIN, reg(zeroHash))).toBe(false);
  });
  it("is true when the schema is registered", async () => {
    expect(await isVouchSchemaRegistered(CHAIN, reg(VOUCH_SCHEMA_UID))).toBe(true);
  });
  it("throws when the RPC fails", async () => {
    const c = {
      readContract: vi.fn(async () => {
        throw new Error("rpc");
      }),
    } as unknown as PublicClient;
    await expect(isVouchSchemaRegistered(CHAIN, c)).rejects.toThrow("rpc");
  });
});
