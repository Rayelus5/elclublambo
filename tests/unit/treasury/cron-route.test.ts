import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const settle = vi.fn();
vi.mock("@/lib/treasury/settle", () => ({ settlePendingDonations: (...a: unknown[]) => settle(...a) }));
const reconcile = vi.fn();
vi.mock("@/lib/treasury/reconcile", () => ({ reconcile: (...a: unknown[]) => reconcile(...a) }));

let safes: Record<number, string | null> = {};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => Promise.resolve({ data: Object.entries(safes).map(([chain_id, safe_address]) => ({ chain_id: Number(chain_id), safe_address })), error: null }) }),
  }),
}));

import { POST } from "@/app/api/cron/dao/route";

const req = (auth?: string) => new Request("http://localhost/api/cron/dao", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret-value");
  safes = { 59144: "0xaaaa", 59141: "0xbbbb" };
  settle.mockResolvedValue({ credited: 1, reverted: 0, pending: 2 });
  reconcile.mockResolvedValue({ ledgerValue: 1n, onchainBalance: 3n, diff: 2n, id: "r1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/dao", () => {
  it("503 when CRON_SECRET is unset, and nothing runs", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("Bearer anything"))).status).toBe(503);
    expect(settle).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "Bearer wrong-secret-xx", "Bearer s3cret-valu", "Bearer s3cret-value2", "s3cret-value", "Basic s3cret-value"])(
    "401 for authorization %j",
    async (auth) => {
      expect((await POST(req(auth))).status).toBe(401);
      expect(settle).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
    },
  );

  it("200 settles and reconciles both chains with a Safe, returning counts", async () => {
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledWith(59144);
    expect(settle).toHaveBeenCalledWith(59141);
    expect(reconcile).toHaveBeenCalledWith(59144, null);
    expect(reconcile).toHaveBeenCalledWith(59141, null);
    const body = await res.json();
    expect(body.chains).toHaveLength(2);
    expect(body.chains[0]).toMatchObject({ chainId: 59144, credited: 1, reverted: 0, pending: 2, diff: "2", reconciliationId: "r1" });
  });

  it("skips reconciliation for a chain without a Safe but still settles it", async () => {
    safes = { 59144: null, 59141: "0xbbbb" };
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(2);
    expect(body.chains.find((c: { chainId: number }) => c.chainId === 59144)).toMatchObject({ skipped: "safe_not_configured" });
  });

  it("one failing chain does not stop the other", async () => {
    reconcile.mockRejectedValueOnce(new Error("rpc down"));
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chains.filter((c: { error?: string }) => c.error)).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
