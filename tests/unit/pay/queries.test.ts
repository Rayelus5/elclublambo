import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: session }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { getMyPublicProfile } from "@/lib/pay/queries";

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ userId: "u1", wallet: "0x1", isMember: false });
});

describe("getMyPublicProfile", () => {
  it("throws on a read error instead of passing for «no profile»", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(getMyPublicProfile()).rejects.toThrow();
  });

  it("null without a profile, and without a session (no read)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getMyPublicProfile()).toBeNull();
    session.mockResolvedValue(null);
    rpc.mockClear();
    expect(await getMyPublicProfile()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
