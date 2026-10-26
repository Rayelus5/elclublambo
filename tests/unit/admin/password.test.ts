import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const timingSafeEqual = vi.hoisted(() => ({ spy: null as null | ReturnType<typeof vi.fn> }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const spy = vi.fn(actual.timingSafeEqual);
  timingSafeEqual.spy = spy;
  return { ...actual, default: { ...actual, timingSafeEqual: spy }, timingSafeEqual: spy };
});

import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "@/lib/admin/password";

// A-R10: el mismo regex que comprueba la migración.
const FORMAT = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

describe("password (A-R10)", () => {
  it("exports the length bounds", () => {
    expect(PASSWORD_MIN).toBe(12);
    expect(PASSWORD_MAX).toBe(128);
  });

  it("round-trips and rejects another password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse battery!", stored)).toBe(false);
  });

  it("salts: two hashes of the same password differ", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
  });

  it("uses the A-R10 format and parameters", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(FORMAT);
    const [, n, r, p, salt, hash] = stored.split("$");
    expect([n, r, p]).toEqual(["32768", "8", "1"]);
    expect(Buffer.from(salt!, "base64")).toHaveLength(16);
    expect(Buffer.from(hash!, "base64")).toHaveLength(64);
  });

  it.each([
    ["scrypt$1$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["scrypt$32768$8$1$%%%$AAAA"],
    ["scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$A"],
    ["scrypt$32768$8$1"],
    ["bcrypt$whatever"],
    [""],
    ["scrypt$1048576$64$16$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(88)],
  ])("a tampered stored value %s is false without throwing", async (stored) => {
    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(false);
  });

  it("a tampered hash (same format, other bytes) is false", async () => {
    const stored = await hashPassword("correct horse battery");
    const parts = stored.split("$");
    parts[5] = Buffer.alloc(64, 1).toString("base64");
    expect(await verifyPassword("correct horse battery", parts.join("$"))).toBe(false);
  });

  it("compares with timingSafeEqual", async () => {
    const stored = await hashPassword("correct horse battery");
    timingSafeEqual.spy!.mockClear();
    await verifyPassword("correct horse battery", stored);
    expect(timingSafeEqual.spy).toHaveBeenCalledTimes(1);
  });
});
