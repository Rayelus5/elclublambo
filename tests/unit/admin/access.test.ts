import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAccessCache, MAINTENANCE_BANNER_COOKIE, maintenanceAccess } from "../../../src/lib/admin/access";

const SA = "0x" + "a".repeat(40);
const OTHER = "0x" + "b".repeat(40);
const user = (id: string, wallet = OTHER) => ({
  id,
  identities: [{ provider: "web3", identity_data: { custom_claims: { address: wallet } } }],
});
const client = (impl: () => Promise<{ data: unknown; error: unknown }>) => {
  const rpc = vi.fn(impl);
  return { rpc, client: { rpc } as unknown as Parameters<typeof maintenanceAccess>[0] };
};
const env = { SUPER_ADMIN_WALLET: SA };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  __resetAccessCache();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("maintenanceAccess", () => {
  it("exports the banner cookie name", () => expect(MAINTENANCE_BANNER_COOKIE).toBe("elclub-mnt"));

  it("lets the SUPER_ADMIN_WALLET in without asking the database", async () => {
    const { rpc, client: c } = client(async () => ({ data: null, error: { message: "boom" } }));
    expect(await maintenanceAccess(c, user("sa", SA.toUpperCase().replace("0X", "0x")), env)).toBe("superadmin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["superadmin", "superadmin"],
    ["granted", "granted"],
    ["listed", "none"],
    ["none", "none"],
    [null, "none"],
  ])("maps rpc %s to %s", async (data, expected) => {
    const { rpc, client: c } = client(async () => ({ data, error: null }));
    expect(await maintenanceAccess(c, user("u1"), env)).toBe(expected);
    expect(rpc).toHaveBeenCalledWith("my_maintenance_access");
  });

  it("an rpc error is none", async () => {
    const { client: c } = client(async () => ({ data: "granted", error: { message: "x" } }));
    expect(await maintenanceAccess(c, user("u1"), env)).toBe("none");
  });

  it("an rpc that throws is none", async () => {
    const { client: c } = client(async () => {
      throw new Error("network");
    });
    expect(await maintenanceAccess(c, user("u1"), env)).toBe("none");
  });

  it("caches a granted for 5 s per user", async () => {
    const { rpc, client: c } = client(async () => ({ data: "granted", error: null }));
    expect(await maintenanceAccess(c, user("u1"), env)).toBe("granted");
    expect(await maintenanceAccess(c, user("u1"), env)).toBe("granted");
    expect(rpc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    await maintenanceAccess(c, user("u1"), env);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not cache a none", async () => {
    const { rpc, client: c } = client(async () => ({ data: "listed", error: null }));
    await maintenanceAccess(c, user("u1"), env);
    await maintenanceAccess(c, user("u1"), env);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("empties the cache past 500 users", async () => {
    const { rpc, client: c } = client(async () => ({ data: "granted", error: null }));
    for (let i = 0; i < 501; i++) await maintenanceAccess(c, user(`u${i}`), env);
    expect(rpc).toHaveBeenCalledTimes(501);
    await maintenanceAccess(c, user("u0"), env);
    expect(rpc).toHaveBeenCalledTimes(502);
  });
});
