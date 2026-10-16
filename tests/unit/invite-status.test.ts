import { describe, expect, it } from "vitest";
import { inviteStatus } from "@/lib/invites/status";

const NOW = new Date("2026-10-16T12:00:00Z");
const base = {
  max_uses: 5,
  uses: 0,
  expires_at: "2026-10-17T12:00:00Z",
  revoked_at: null as string | null,
};

describe("inviteStatus", () => {
  it("is activa when valid", () => {
    expect(inviteStatus(base, NOW)).toBe("activa");
  });
  it("is agotada when uses reached", () => {
    expect(inviteStatus({ ...base, uses: 5 }, NOW)).toBe("agotada");
  });
  it("is caducada when expired", () => {
    expect(inviteStatus({ ...base, expires_at: "2026-10-16T11:59:59Z" }, NOW)).toBe("caducada");
    expect(inviteStatus({ ...base, expires_at: "2026-10-16T12:00:00Z" }, NOW)).toBe("caducada");
  });
  it("is anulada when revoked", () => {
    expect(inviteStatus({ ...base, revoked_at: "2026-10-16T10:00:00Z" }, NOW)).toBe("anulada");
  });
  it("applies precedence anulada > caducada > agotada", () => {
    const all = { ...base, uses: 5, expires_at: "2026-10-01T00:00:00Z", revoked_at: "2026-10-02T00:00:00Z" };
    expect(inviteStatus(all, NOW)).toBe("anulada");
    expect(inviteStatus({ ...all, revoked_at: null }, NOW)).toBe("caducada");
    expect(inviteStatus({ ...all, revoked_at: null, expires_at: base.expires_at }, NOW)).toBe("agotada");
  });
});
