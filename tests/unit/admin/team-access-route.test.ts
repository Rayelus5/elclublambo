import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_STATE, type SiteState } from "@/lib/admin/state";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  hitRateLimit: vi.fn(),
  hitIpRateLimit: vi.fn(),
  getSiteState: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.adminRpc }) }));
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit: m.hitRateLimit }));
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit: m.hitIpRateLimit }));
vi.mock("@/lib/admin/site-state", () => ({ getSiteState: m.getSiteState }));
vi.mock("@/lib/admin/password", () => ({ verifyPassword: m.verifyPassword, PASSWORD_MIN: 12, PASSWORD_MAX: 128 }));

import { POST } from "@/app/api/team-access/route";

const PASSWORD = "correct horse battery";
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==";
const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  identities: [{ provider: "web3", identity_data: { custom_claims: { address: "0x" + "b".repeat(40) } } }],
};
const ON: SiteState = { ...OPEN_STATE, maintenance: { ...OPEN_STATE.maintenance, enabled: true } };

const call = (body: unknown = {}, site: string | null = "same-origin") =>
  POST(
    new NextRequest("http://localhost:3000/api/team-access", {
      method: "POST",
      headers: { "content-type": "application/json", ...(site === null ? {} : { "sec-fetch-site": site }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

/** my_maintenance_access result for the session client. */
const access = (value: string) =>
  m.rpc.mockImplementation(async (fn: string) =>
    fn === "my_maintenance_access" ? { data: value, error: null } : { data: null, error: { message: "unexpected" } },
  );
const admin = (grant: string = "granted") =>
  m.adminRpc.mockImplementation(async (fn: string) => {
    if (fn === "maintenance_password_record") return { data: { hash: HASH, version: 3 }, error: null };
    if (fn === "grant_maintenance_access") return { data: grant, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
const called = (spy: ReturnType<typeof vi.fn>, fn: string) => spy.mock.calls.filter((c) => c[0] === fn);

beforeEach(() => {
  vi.clearAllMocks();
  m.getUser.mockResolvedValue({ data: { user: USER }, error: null });
  m.getSiteState.mockResolvedValue(ON);
  m.hitRateLimit.mockResolvedValue("ok");
  m.hitIpRateLimit.mockResolvedValue("ok");
  m.verifyPassword.mockResolvedValue(true);
  access("listed");
  admin();
  vi.stubEnv("SUPER_ADMIN_WALLET", "0x" + "a".repeat(40));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function expectJson(res: Response, status: number, body: unknown) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual(body);
}

describe("POST /api/team-access — fixed answers", () => {
  it.each(["cross-site", "same-site", "none"])("sec-fetch-site %s → 403", async (site) => {
    await expectJson(await call({}, site), 403, { error: "forbidden" });
    expect(m.getUser).not.toHaveBeenCalled();
  });

  it("without sec-fetch-site → 403", async () => {
    await expectJson(await call({}, null), 403, { error: "forbidden" });
  });

  it("without a session → 401 not_signed_in", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectJson(await call({ password: PASSWORD }), 401, { status: "not_signed_in" });
    expect(m.hitRateLimit).not.toHaveBeenCalled();
  });

  it("maintenance off → off, nothing charged", async () => {
    m.getSiteState.mockResolvedValue(OPEN_STATE);
    await expectJson(await call({ password: PASSWORD }), 200, { status: "off" });
    expect(m.hitIpRateLimit).not.toHaveBeenCalled();
    expect(m.adminRpc).not.toHaveBeenCalled();
  });

  it("a scheduled window that has ended → off", async () => {
    m.getSiteState.mockResolvedValue({
      ...ON,
      maintenance: { ...ON.maintenance, enabled: false, startsAt: "2000-01-01T00:00:00+00:00", endsAt: "2000-01-02T00:00:00+00:00" },
    });
    await expectJson(await call({}), 200, { status: "off" });
  });
});

describe("POST /api/team-access — without password", () => {
  it.each([
    ["listed", "needs_password"],
    ["none", "not_listed"],
    ["granted", "granted"],
    ["superadmin", "superadmin"],
  ])("my_maintenance_access %s → %s, nothing charged", async (value, status) => {
    access(value);
    await expectJson(await call({}), 200, { status });
    expect(m.hitRateLimit).not.toHaveBeenCalled();
    expect(m.hitIpRateLimit).not.toHaveBeenCalled();
    expect(m.adminRpc).not.toHaveBeenCalled();
  });

  it("an empty body is the no-password question", async () => {
    await expectJson(await call(""), 200, { status: "needs_password" });
  });

  it("the SUPER_ADMIN_WALLET is superadmin without the database (A-R6)", async () => {
    m.getUser.mockResolvedValue({
      data: { user: { ...USER, identities: [{ provider: "web3", identity_data: { custom_claims: { address: "0x" + "a".repeat(40) } } }] } },
      error: null,
    });
    access("none");
    await expectJson(await call({}), 200, { status: "superadmin" });
  });

  it("an rpc error → 503 error", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expectJson(await call({}), 503, { status: "error" });
  });
});

describe("POST /api/team-access — with password", () => {
  it.each([[""], ["x".repeat(129)], [42], [null]])("password %j → 400 invalid, nothing charged", async (password) => {
    await expectJson(await call({ password }), 400, { status: "invalid" });
    expect(m.hitIpRateLimit).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400 invalid", async () => {
    await expectJson(await call("{nope"), 400, { status: "invalid" });
  });

  // The body is capped at 4 KB (a password is at most 128 characters): PRE buffers up to 100 MB behind the tunnel.
  it("a body over 4 KB → 400 invalid, before any bucket or password check", async () => {
    const big = JSON.stringify({ password: PASSWORD, pad: "x".repeat(5000) });
    await expectJson(await call(big), 400, { status: "invalid" });
    expect(m.verifyPassword).not.toHaveBeenCalled();
    expect(m.hitRateLimit).not.toHaveBeenCalled();
    expect(m.hitIpRateLimit).not.toHaveBeenCalled();
  });

  it("a declared content-length over 4 KB → 400 invalid without reading the body", async () => {
    const res = await POST(
      new NextRequest("http://localhost:3000/api/team-access", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "content-length": "100000000" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    await expectJson(res, 400, { status: "invalid" });
    expect(m.verifyPassword).not.toHaveBeenCalled();
  });

  it("a streamed body without content-length is cut at 4 KB too", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        if (sent > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await POST(
      new NextRequest("http://localhost:3000/api/team-access", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" }),
    );
    await expectJson(res, 400, { status: "invalid" });
    expect(sent).toBeLessThan(10);
  });

  it("a body of exactly 4 KB is still read", async () => {
    const base = JSON.stringify({ password: PASSWORD, pad: "" });
    const body = JSON.stringify({ password: PASSWORD, pad: "x".repeat(4096 - base.length) });
    expect(new TextEncoder().encode(body).length).toBe(4096);
    await expectJson(await call(body), 200, { status: "granted" });
  });

  it("charges both buckets before anything else", async () => {
    await call({ password: PASSWORD });
    expect(m.hitIpRateLimit).toHaveBeenCalledWith("maintenance_password", expect.any(Headers));
    expect(m.hitRateLimit).toHaveBeenCalledWith(expect.objectContaining({ rpc: m.rpc }), "maintenance_password");
    const firstCheck = Math.min(
      ...m.rpc.mock.invocationCallOrder.filter((_, i) => m.rpc.mock.calls[i]![0] === "my_maintenance_access"),
    );
    expect(m.hitIpRateLimit.mock.invocationCallOrder[0]).toBeLessThan(firstCheck);
    expect(m.hitRateLimit.mock.invocationCallOrder[0]).toBeLessThan(firstCheck);
  });

  it.each([
    ["rate_limited", "ok"],
    ["ok", "rate_limited"],
    ["rate_limited", "error"],
  ])("ip %s / session %s → 429 without reading the hash", async (ip, session) => {
    m.hitIpRateLimit.mockResolvedValue(ip);
    m.hitRateLimit.mockResolvedValue(session);
    await expectJson(await call({ password: PASSWORD }), 429, { status: "rate_limited" });
    expect(called(m.adminRpc, "maintenance_password_record")).toHaveLength(0);
    expect(m.verifyPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["error", "ok"],
    ["ok", "error"],
  ])("ip %s / session %s → 503 error (fails closed)", async (ip, session) => {
    m.hitIpRateLimit.mockResolvedValue(ip);
    m.hitRateLimit.mockResolvedValue(session);
    await expectJson(await call({ password: PASSWORD }), 503, { status: "error" });
    expect(called(m.adminRpc, "maintenance_password_record")).toHaveLength(0);
  });

  it("none → not_listed, and the hit is still charged", async () => {
    access("none");
    await expectJson(await call({ password: PASSWORD }), 200, { status: "not_listed" });
    expect(m.hitIpRateLimit).toHaveBeenCalledTimes(1);
    expect(m.hitRateLimit).toHaveBeenCalledTimes(1);
    expect(m.adminRpc).not.toHaveBeenCalled();
  });

  it.each(["superadmin", "granted"])("%s → that status without checking the password", async (value) => {
    access(value);
    await expectJson(await call({ password: PASSWORD }), 200, { status: value });
    expect(m.adminRpc).not.toHaveBeenCalled();
  });

  it("no password set (null record) → wrong_password", async () => {
    m.adminRpc.mockResolvedValue({ data: null, error: null });
    await expectJson(await call({ password: PASSWORD }), 200, { status: "wrong_password" });
    expect(m.verifyPassword).not.toHaveBeenCalled();
  });

  it("a wrong password → wrong_password and no grant", async () => {
    m.verifyPassword.mockResolvedValue(false);
    await expectJson(await call({ password: PASSWORD }), 200, { status: "wrong_password" });
    expect(m.verifyPassword).toHaveBeenCalledWith(PASSWORD, HASH);
    expect(called(m.adminRpc, "grant_maintenance_access")).toHaveLength(0);
  });

  it("the right password → granted, grant called with the user and version", async () => {
    await expectJson(await call({ password: PASSWORD }), 200, { status: "granted" });
    expect(m.adminRpc).toHaveBeenCalledWith("grant_maintenance_access", {
      p_auth_user_id: USER.id,
      p_password_version: 3,
    });
  });

  it("stale → wrong_password", async () => {
    admin("stale");
    await expectJson(await call({ password: PASSWORD }), 200, { status: "wrong_password" });
  });

  it("not_listed at grant time → not_listed", async () => {
    admin("not_listed");
    await expectJson(await call({ password: PASSWORD }), 200, { status: "not_listed" });
  });

  it("expired (the window is ending) → off", async () => {
    admin("expired");
    await expectJson(await call({ password: PASSWORD }), 200, { status: "off" });
  });

  it("a record read error → 503 error", async () => {
    m.adminRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expectJson(await call({ password: PASSWORD }), 503, { status: "error" });
  });

  it("a grant error → 503 error", async () => {
    m.adminRpc.mockImplementation(async (fn: string) =>
      fn === "maintenance_password_record"
        ? { data: { hash: HASH, version: 3 }, error: null }
        : { data: null, error: { message: "boom" } },
    );
    await expectJson(await call({ password: PASSWORD }), 503, { status: "error" });
  });

  it("never logs or returns the password or the hash", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
    const bodies: string[] = [];
    for (const setup of [
      () => m.verifyPassword.mockResolvedValue(false),
      () => m.verifyPassword.mockRejectedValue(new Error(`bad ${HASH} ${PASSWORD}`)),
      () => m.verifyPassword.mockResolvedValue(true),
      () =>
        m.adminRpc.mockImplementation(async (fn: string) => {
          if (fn === "maintenance_password_record") return { data: { hash: HASH, version: 3 }, error: null };
          throw new Error(`boom ${HASH} ${PASSWORD}`);
        }),
      () => m.rpc.mockRejectedValue(new Error(`boom ${PASSWORD}`)),
    ]) {
      setup();
      bodies.push(await (await call({ password: PASSWORD })).text());
    }
    const logged = spies.flatMap((s) => s.mock.calls).map((c) => JSON.stringify(c.map(String)));
    expect(logged.length).toBeGreaterThan(0);
    for (const text of [...logged, ...bodies]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(HASH);
      expect(text).not.toContain("aGFzaA==");
    }
    spies.forEach((s) => s.mockRestore());
  });
});
