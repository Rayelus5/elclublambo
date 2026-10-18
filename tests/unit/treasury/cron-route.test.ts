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

  it("200 runs snapshot → scan → settle on each chain with a Safe and reports all three", async () => {
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(steps).toEqual(["snapshot:59144", "scan:59144", "settle:59144", "snapshot:59141", "scan:59141", "settle:59141"]);
    const body = await res.json();
    expect(body.chains).toHaveLength(2);
    expect(body.chains[0]).toEqual({ chainId: 59144, snapshot: "taken", scan: { inserted: 2, alerts: 1 }, credited: 1, reverted: 0, pending: 2 });
    expect(body.chains[0]).not.toHaveProperty("diff");
  });

  it("a chain without a Safe skips snapshot and scan but still settles", async () => {
    safes = { 59144: null, 59141: "0xbbbb" };
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(steps).toEqual(["settle:59144", "snapshot:59141", "scan:59141", "settle:59141"]);
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
    err.mockRestore();
  });

  it("a failing step does not stop the others, on that chain or the next", async () => {
    snapshot.mockRejectedValueOnce(new Error("rpc down"));
    scan.mockRejectedValueOnce(new Error("rpc down")).mockRejectedValueOnce(new Error("rpc down"));
    settle.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(steps).toHaveLength(6);
    const [a, b] = (await res.json()).chains;
    expect(a).toEqual({ chainId: 59144, snapshot: "failed", scan: "failed", error: "settle_failed" });
    expect(b).toEqual({ chainId: 59141, snapshot: "taken", scan: "failed", credited: 1, reverted: 0, pending: 2 });
    err.mockRestore();
  });

  it("reports an unavailable valuation and a null scan as they come", async () => {
    snapshot.mockResolvedValue("unavailable");
    scan.mockResolvedValue(null);
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(body.chains[1]).toMatchObject({ snapshot: "unavailable", scan: null });
  });
});
