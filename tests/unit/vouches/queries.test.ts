// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const getVouchSchemaRegistered = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/verify", () => ({ getVouchSchemaRegistered }));

import { getVouchAvailability, getVouchesFor, getVouchesGivenBy } from "@/lib/vouches/queries";

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const B = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const UID = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
});

describe("getVouchesFor", () => {
  it("maps the RPC's JSON", async () => {
    rpc.mockResolvedValue({
      data: {
        total: 2,
        counts: [
          { kind: 1, attesters: 2 },
          { kind: 9, attesters: 1 },
        ],
        items: [
          { uid: UID, chainId: 84532, kind: 9, attester: A, attesterAlias: "ana", attestedAt: "2026-10-25T10:00:00+00:00", txHash: TX },
          { uid: UID.replace("ab", "ef"), chainId: 84532, kind: 1, attester: B, attesterAlias: null, attestedAt: "2026-10-24T10:00:00+00:00", txHash: TX },
        ],
      },
      error: null,
    });
    expect(await getVouchesFor(B.toUpperCase().replace("0X", "0x"))).toEqual({
      total: 2,
      counts: [
        { kind: 1, attesters: 2 },
        { kind: 9, attesters: 1 },
      ],
      items: [
        { uid: UID, chainId: 84532, kind: 9, attester: A, attesterAlias: "ana", attestedAt: "2026-10-25T10:00:00+00:00", txHash: TX },
        { uid: UID.replace("ab", "ef"), chainId: 84532, kind: 1, attester: B, attesterAlias: null, attestedAt: "2026-10-24T10:00:00+00:00", txHash: TX },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("vouches_for", { p_recipient: B });
  });

  it("drops malformed items and defaults missing parts", async () => {
    rpc.mockResolvedValue({ data: { items: [{ uid: 5 }, null] }, error: null });
    expect(await getVouchesFor(B)).toEqual({ total: 0, counts: [], items: [] });
  });

  it("throws on a read error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(getVouchesFor(B)).rejects.toThrow();
  });
});

describe("getVouchesGivenBy", () => {
  it("maps uid, kind and recipient (the form blocks a duplicate with them)", async () => {
    rpc.mockResolvedValue({
      data: [{ uid: UID, chainId: 84532, kind: 3, recipient: B, recipientAlias: "bea", attestedAt: "2026-10-25T10:00:00+00:00" }, { kind: 1 }],
      error: null,
    });
    expect(await getVouchesGivenBy(A)).toEqual([{ uid: UID, chainId: 84532, kind: 3, recipient: B, recipientAlias: "bea", attestedAt: "2026-10-25T10:00:00+00:00" }]);
    expect(rpc).toHaveBeenCalledWith("vouches_given_by", { p_attester: A });
  });

  it("throws on a read error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(getVouchesGivenBy(A)).rejects.toThrow();
  });
});

describe("getVouchAvailability", () => {
  it("the app's Base chain and whether the schema is registered", async () => {
    getVouchSchemaRegistered.mockResolvedValue(true);
    expect(await getVouchAvailability()).toEqual({ chainId: 84532, registered: true });
    expect(getVouchSchemaRegistered).toHaveBeenCalledWith(84532);
    getVouchSchemaRegistered.mockResolvedValue(false);
    expect(await getVouchAvailability()).toEqual({ chainId: 84532, registered: false });
  });

  it("registered: null when the RPC throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getVouchSchemaRegistered.mockRejectedValue(new Error("rpc down"));
    expect(await getVouchAvailability()).toEqual({ chainId: 84532, registered: null });
  });

  it("mainnet uses 8453", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    getVouchSchemaRegistered.mockResolvedValue(true);
    expect(await getVouchAvailability()).toEqual({ chainId: 8453, registered: true });
  });
});
