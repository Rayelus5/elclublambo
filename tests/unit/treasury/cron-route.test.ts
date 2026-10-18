import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const order: string[] = [];
const connection = vi.fn(async () => void order.push("connection"));
vi.mock("next/server", () => ({ connection: () => connection() }));

const steps: string[] = [];
const settle = vi.fn();
vi.mock("@/lib/treasury/settle", () => ({ settlePendingDonations: (...a: unknown[]) => (steps.push(`settle:${a[0]}`), settle(...a)) }));
const snapshot = vi.fn();
vi.mock("@/lib/treasury/snapshot", () => ({ takeSnapshot: (...a: unknown[]) => (steps.push(`snapshot:${a[0]}`), snapshot(...a)) }));
const scan = vi.fn();
vi.mock("@/lib/treasury/scan", () => ({ scanSafeOperations: (...a: unknown[]) => (steps.push(`scan:${a[0]}`), scan(...a)) }));
const detect = vi.fn();
const finalize = vi.fn();
const expire = vi.fn();
vi.mock("@/lib/treasury/payouts", () => ({
  detectWithdrawalPayouts: (...a: unknown[]) => (steps.push(`detect:${a[0]}`), detect(...a)),
  finalizeWithdrawalPayouts: (...a: unknown[]) => (steps.push(`finalize:${a[0]}`), finalize(...a)),
  expireWithdrawalApprovals: (...a: unknown[]) => (steps.push("expire"), expire(...a)),
}));

let safes: Record<number, string | null> = {};
let cfgError: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => Promise.resolve({ error: cfgError, data: cfgError ? null : Object.entries(safes).map(([chain_id, safe_address]) => ({ chain_id: Number(chain_id), safe_address })) }) }),
  }),
}));

import { GET, POST } from "@/app/api/cron/dao/route";

const req = (auth?: string, method = "POST") => new Request("http://localhost/api/cron/dao", { method, headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret-value");
  safes = { 59144: "0xaaaa", 59141: "0xbbbb" };
  cfgError = null;
  settle.mockResolvedValue({ credited: 1, reverted: 0, pending: 2 });
  steps.length = 0;
  snapshot.mockResolvedValue("taken");
  scan.mockResolvedValue({ inserted: 2, alerts: 1 });
  detect.mockResolvedValue({ recorded: 1 });
  finalize.mockResolvedValue({ paid: 1, reverted: 0, pending: 3 });
  expire.mockResolvedValue(2);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/dao", () => {
  it("waits for a real request (connection) before reading the env or answering, so GET is never prerendered", async () => {
    order.length = 0;
    vi.stubEnv("CRON_SECRET", "");
    const res = POST(req("Bearer x"));
    expect(order).toEqual(["connection"]);
    expect((await res).status).toBe(503);
    expect(connection).toHaveBeenCalledTimes(1);
    await GET(req("Bearer x", "GET"));
    expect(connection).toHaveBeenCalledTimes(2);
  });

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
      expect(snapshot).not.toHaveBeenCalled();
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it("200 runs snapshot → scan → payouts (detect, finalize) → settle on each chain with a Safe, then expiry once", async () => {
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(steps).toEqual([
      "snapshot:59144", "scan:59144", "detect:59144", "finalize:59144", "settle:59144",
      "snapshot:59141", "scan:59141", "detect:59141", "finalize:59141", "settle:59141",
      "expire",
    ]);
    const body = await res.json();
    expect(body.chains).toHaveLength(2);
    expect(body.chains[0]).toEqual({
      chainId: 59144, snapshot: "taken", scan: { inserted: 2, alerts: 1 }, payouts: { recorded: 1, paid: 1, reverted: 0, pending: 3 },
      credited: 1, reverted: 0, pending: 2,
    });
    expect(body.chains[0]).not.toHaveProperty("diff");
    expect(body.expiredApprovals).toBe(2);
  });

  it("Review Focus 4: every chain's payout detection runs before approvals are expired", async () => {
    await POST(req("Bearer s3cret-value"));
    const expireAt = steps.indexOf("expire");
    expect(expireAt).toBe(steps.length - 1);
    expect(steps.indexOf("detect:59144")).toBeLessThan(expireAt);
    expect(steps.indexOf("detect:59141")).toBeLessThan(expireAt);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("a throwing payouts step reports failed while the others still run", async () => {
    detect.mockRejectedValueOnce(new Error("rpc down")); // 59144's detection
    finalize.mockResolvedValueOnce({ paid: 0, reverted: 0, pending: 0 }).mockRejectedValueOnce(new Error("rpc down")); // 59141's
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(body.chains[0]).toMatchObject({ payouts: "failed", snapshot: "taken", credited: 1 });
    expect(body.chains[1]).toMatchObject({ payouts: "failed", credited: 1 });
    // a failing detection does not skip the finalization (nor the other way round)
    expect(steps).toEqual(expect.arrayContaining(["finalize:59144", "detect:59141", "settle:59144", "settle:59141"]));
    expect(steps.at(-1)).toBe("expire");
    expect(body.expiredApprovals).toBe(2);
    err.mockRestore();
  });

  it("a throwing expiry reports expiredApprovals failed and keeps the chain reports", async () => {
    expire.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiredApprovals).toBe("failed");
    expect(body.chains).toHaveLength(2);
    err.mockRestore();
  });

  it("a chain without a Safe skips snapshot and scan but still settles", async () => {
    safes = { 59144: null, 59141: "0xbbbb" };
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(steps).toEqual(["settle:59144", "snapshot:59141", "scan:59141", "detect:59141", "finalize:59141", "settle:59141", "expire"]);
    expect(body.chains.find((c: { chainId: number }) => c.chainId === 59144)).toMatchObject({ skipped: "safe_not_configured", credited: 1 });
  });

  it("GET (Vercel Cron) has the same auth and the same behaviour", async () => {
    expect((await GET(req(undefined, "GET"))).status).toBe(401);
    expect((await GET(req("Bearer nope", "GET"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer s3cret-value", "GET"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const res = await GET(req("Bearer s3cret-value", "GET"));
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("a chain_config read error answers 500 and runs nothing", async () => {
    cfgError = { message: "db down" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req("Bearer s3cret-value"))).status).toBe(500);
    expect(steps).toEqual([]);
    expect(expire).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("a failing step does not stop the others, on that chain or the next", async () => {
    snapshot.mockRejectedValueOnce(new Error("rpc down"));
    scan.mockRejectedValueOnce(new Error("rpc down")).mockRejectedValueOnce(new Error("rpc down"));
    settle.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(steps).toHaveLength(11);
    const [a, b] = (await res.json()).chains;
    expect(a).toEqual({ chainId: 59144, snapshot: "failed", scan: "failed", payouts: { recorded: 1, paid: 1, reverted: 0, pending: 3 }, error: "settle_failed" });
    expect(b).toEqual({ chainId: 59141, snapshot: "taken", scan: "failed", payouts: { recorded: 1, paid: 1, reverted: 0, pending: 3 }, credited: 1, reverted: 0, pending: 2 });
    err.mockRestore();
  });

  it("reports an unavailable valuation and a null scan as they come", async () => {
    snapshot.mockResolvedValue("unavailable");
    scan.mockResolvedValue(null);
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(body.chains[1]).toMatchObject({ snapshot: "unavailable", scan: null });
  });
});
