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
const cursorTime = vi.fn();
vi.mock("@/lib/treasury/payouts", () => ({
  detectWithdrawalPayouts: (...a: unknown[]) => (steps.push(`detect:${a[0]}`), detect(...a)),
  finalizeWithdrawalPayouts: (...a: unknown[]) => (steps.push(`finalize:${a[0]}`), finalize(...a)),
  scanCursorTime: (...a: unknown[]) => (steps.push(`cursor:${a[0]}`), cursorTime(...a)),
  expireWithdrawalApprovals: (...a: unknown[]) => (steps.push(`expire:${a[0]}`), expire(...a)),
}));
const raffles = vi.fn();
vi.mock("@/lib/treasury/raffle-cron", () => ({ runRaffleSteps: (...a: unknown[]) => (steps.push(`raffles:${a[0]}`), raffles(...a)) }));
const finalizePolls = vi.fn();
vi.mock("@/lib/polls/cron", () => ({ finalizeDuePolls: (...a: unknown[]) => (steps.push("polls"), finalizePolls(...a)) }));
const RAFFLES = {
  closed: 1, voided: 0, drawn: 1, pending: 0, recorded: 0, paid: 1, reverted: 0, unpaidNotices: 0, awaitingFinality: 1,
  refusedDraws: [{ raffleId: "r1", code: "draw_block_invalid" }],
};
const SCANNED = new Date("2026-10-19T11:59:00.000Z");

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
  cursorTime.mockResolvedValue(SCANNED);
  raffles.mockResolvedValue(RAFFLES);
  finalizePolls.mockResolvedValue({ finalized: 2 });
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

  it("200 runs the polls step (F4e-R4), then scan → payouts (detect, finalize) → raffles → snapshot → settle per chain with a Safe, then expiry per chain (F4c-R7 c)", async () => {
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(steps).toEqual([
      "polls",
      "scan:59144", "cursor:59144", "detect:59144", "finalize:59144", "raffles:59144", "snapshot:59144", "settle:59144",
      "scan:59141", "cursor:59141", "detect:59141", "finalize:59141", "raffles:59141", "snapshot:59141", "settle:59141",
      "expire:59144", "expire:59141",
    ]);
    const body = await res.json();
    expect(body.chains).toHaveLength(2);
    expect(body.polls).toEqual({ finalized: 2 });
    expect(body.chains[0]).toEqual({
      chainId: 59144, snapshot: "taken", scan: { inserted: 2, alerts: 1 }, payouts: { recorded: 1, paid: 1, reverted: 0, awaitingFinality: 3 },
      raffles: RAFFLES, credited: 1, reverted: 0, pending: 2, expiredApprovals: 2,
    });
    expect(body.chains[0]).not.toHaveProperty("diff");
  });

  it("R5: each chain's expiry is bounded by the block time of the scan cursor it just reached", async () => {
    cursorTime.mockImplementation(async (c: number) => (c === 59144 ? new Date("2026-10-19T10:00:00.000Z") : SCANNED));
    await POST(req("Bearer s3cret-value"));
    expect(expire.mock.calls).toEqual([
      [59144, new Date("2026-10-19T10:00:00.000Z")],
      [59141, SCANNED],
    ]);
  });

  it("Review Focus 4: every chain's payout detection runs before any approval is expired", async () => {
    await POST(req("Bearer s3cret-value"));
    const firstExpire = steps.findIndex((s) => s.startsWith("expire:"));
    expect(steps.indexOf("detect:59144")).toBeLessThan(firstExpire);
    expect(steps.indexOf("detect:59141")).toBeLessThan(firstExpire);
    expect(expire).toHaveBeenCalledTimes(2);
  });

  it("R5: a chain whose scan failed this run expires nothing (skipped); the other chain still expires", async () => {
    scan.mockRejectedValueOnce(new Error("rpc down")); // 59144
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(steps).not.toContain("cursor:59144");
    expect(steps).not.toContain("expire:59144");
    expect(expire.mock.calls).toEqual([[59141, SCANNED]]);
    expect(body.chains[0]).toMatchObject({ scan: "failed", expiredApprovals: "skipped" });
    expect(body.chains[1]).toMatchObject({ expiredApprovals: 2 });
    err.mockRestore();
  });

  it("R5: no expiry for a chain whose scan returned null or whose cursor time cannot be read", async () => {
    scan.mockResolvedValueOnce(null); // 59144: Safe unset meanwhile
    cursorTime.mockResolvedValueOnce(null); // 59141 (the only cursor read)
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(expire).not.toHaveBeenCalled();
    expect(body.chains[0]).toMatchObject({ expiredApprovals: "skipped" });
    expect(body.chains[1]).toMatchObject({ expiredApprovals: "skipped" });
  });

  it("a throwing payouts step reports failed while the others still run", async () => {
    detect.mockRejectedValueOnce(new Error("rpc down")); // 59144's detection
    finalize.mockResolvedValueOnce({ paid: 0, reverted: 0, pending: 0 }).mockRejectedValueOnce(new Error("rpc down")); // 59141's
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(body.chains[0]).toMatchObject({ payouts: "failed", snapshot: "taken", credited: 1, expiredApprovals: 2 });
    expect(body.chains[1]).toMatchObject({ payouts: "failed", credited: 1, expiredApprovals: 2 });
    // a failing detection does not skip the finalization (nor the other way round)
    expect(steps).toEqual(expect.arrayContaining(["finalize:59144", "detect:59141", "settle:59144", "settle:59141"]));
    expect(steps.at(-1)).toBe("expire:59141");
    err.mockRestore();
  });

  it("a throwing runRaffleSteps reports raffles failed while snapshot and settle still run", async () => {
    raffles.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce("failed");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(body.chains[0]).toMatchObject({ raffles: "failed", snapshot: "taken", credited: 1 });
    expect(body.chains[1]).toMatchObject({ raffles: "failed", snapshot: "taken", credited: 1 });
    expect(steps).toEqual(expect.arrayContaining(["snapshot:59144", "settle:59144", "snapshot:59141", "settle:59141"]));
    err.mockRestore();
  });

  it("raffles run after the withdrawal payouts and before the snapshot (a prize payout is linked before valuing)", async () => {
    await POST(req("Bearer s3cret-value"));
    expect(steps.indexOf("finalize:59141")).toBeLessThan(steps.indexOf("raffles:59141"));
    expect(steps.indexOf("raffles:59141")).toBeLessThan(steps.indexOf("snapshot:59141"));
    expect(steps.indexOf("raffles:59141")).toBeLessThan(steps.indexOf("settle:59141"));
  });

  it("a throwing expiry reports that chain's expiredApprovals failed and keeps the others", async () => {
    expire.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chains[0].expiredApprovals).toBe("failed");
    expect(body.chains[1].expiredApprovals).toBe(2);
    err.mockRestore();
  });

  it("a chain without a Safe skips snapshot and scan but still settles", async () => {
    safes = { 59144: null, 59141: "0xbbbb" };
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(steps).toEqual(["polls", "settle:59144", "scan:59141", "cursor:59141", "detect:59141", "finalize:59141", "raffles:59141", "snapshot:59141", "settle:59141", "expire:59141"]);
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

  it("a chain_config read error answers 500 and runs no chain step, but the polls still finalize (F4e-R4)", async () => {
    cfgError = { message: "db down" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(steps).toEqual(["polls"]);
    expect(expire).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "chain_config_unavailable", polls: { finalized: 2 } });
    err.mockRestore();
  });

  it("a chain_config read error with a throwing polls step reports both", async () => {
    cfgError = { message: "db down" };
    finalizePolls.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "chain_config_unavailable", polls: "failed" });
    err.mockRestore();
  });

  it("a failing step does not stop the others, on that chain or the next", async () => {
    snapshot.mockRejectedValueOnce(new Error("rpc down"));
    scan.mockRejectedValueOnce(new Error("rpc down")).mockRejectedValueOnce(new Error("rpc down"));
    settle.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(steps).toHaveLength(13); // both scans failed: no cursor read, no expiry; the polls step still ran
    const [a, b] = (await res.json()).chains;
    expect(a).toEqual({ chainId: 59144, snapshot: "failed", scan: "failed", payouts: { recorded: 1, paid: 1, reverted: 0, awaitingFinality: 3 }, raffles: RAFFLES, error: "settle_failed", expiredApprovals: "skipped" });
    expect(b).toEqual({ chainId: 59141, snapshot: "taken", scan: "failed", payouts: { recorded: 1, paid: 1, reverted: 0, awaitingFinality: 3 }, raffles: RAFFLES, credited: 1, reverted: 0, pending: 2, expiredApprovals: "skipped" });
    err.mockRestore();
  });

  it("a throwing polls step reports polls failed while every chain step still ran", async () => {
    finalizePolls.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.polls).toBe("failed");
    expect(body.chains[0]).toMatchObject({ snapshot: "taken", credited: 1, expiredApprovals: 2 });
    expect(body.chains[1]).toMatchObject({ snapshot: "taken", credited: 1, expiredApprovals: 2 });
    err.mockRestore();
  });

  it("runs the polls step once, first: before the chain_config read and any chain step (F4e-R4)", async () => {
    await POST(req("Bearer s3cret-value"));
    expect(finalizePolls).toHaveBeenCalledTimes(1);
    expect(steps[0]).toBe("polls");
    expect(steps.filter((s) => s === "polls")).toHaveLength(1);
  });

  it("reports an unavailable valuation and a null scan as they come", async () => {
    snapshot.mockResolvedValue("unavailable");
    scan.mockResolvedValue(null);
    const body = await (await POST(req("Bearer s3cret-value"))).json();
    expect(body.chains[1]).toMatchObject({ snapshot: "unavailable", scan: null });
  });
});
