import { beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "0x9F202eb556F95308de0268f60b5757d83744De02";
vi.mock("server-only", () => ({}));
const getUser = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser }, rpc }) }));

import { getPublicSession } from "@/lib/auth/public-session";

const user = { id: "u1", identities: [{ provider: "web3", identity_data: { custom_claims: { address: WALLET } } }] };

beforeEach(() => vi.resetAllMocks());

describe("getPublicSession", () => {
  it("no user -> null", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getPublicSession()).toBeNull();
  });
  it("user without wallet -> null", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", identities: [] } } });
    expect(await getPublicSession()).toBeNull();
  });
  it("wallet without membership -> not a member", async () => {
    getUser.mockResolvedValue({ data: { user } });
    rpc.mockResolvedValue({ data: "none", error: null });
    expect(await getPublicSession()).toEqual({ userId: "u1", wallet: WALLET.toLowerCase(), isMember: false });
  });
  it("active member -> isMember", async () => {
    getUser.mockResolvedValue({ data: { user } });
    rpc.mockResolvedValue({ data: "active", error: null });
    expect((await getPublicSession())?.isMember).toBe(true);
  });
  it("banned -> null (no public account)", async () => {
    getUser.mockResolvedValue({ data: { user } });
    rpc.mockResolvedValue({ data: "banned", error: null });
    expect(await getPublicSession()).toBeNull();
  });
});
