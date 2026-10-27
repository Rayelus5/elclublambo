import { describe, expect, it } from "vitest";
import {
  OPEN_STATE,
  SWITCH_KEYS,
  isMaintenanceActive,
  parseSiteState,
  retryAfterSeconds,
  type MaintenanceConfig,
} from "../../../src/lib/admin/state";

const NOW = Date.parse("2030-01-01T12:00:00.000Z");
const m = (o: Partial<MaintenanceConfig>): MaintenanceConfig => ({ ...OPEN_STATE.maintenance, ...o });
const iso = (ms: number) => new Date(ms).toISOString();

describe("isMaintenanceActive", () => {
  it("is off by default", () => expect(isMaintenanceActive(OPEN_STATE.maintenance, NOW)).toBe(false));
  it("is on when enabled", () => expect(isMaintenanceActive(m({ enabled: true }), NOW)).toBe(true));
  it("ends exactly at endsAt", () => {
    expect(isMaintenanceActive(m({ enabled: true, endsAt: iso(NOW) }), NOW)).toBe(false);
    expect(isMaintenanceActive(m({ enabled: true, endsAt: iso(NOW + 1) }), NOW)).toBe(true);
  });
  it("a future startsAt with enabled false is not active", () => {
    expect(isMaintenanceActive(m({ enabled: false, startsAt: iso(NOW + 1000) }), NOW)).toBe(false);
  });
  it("a past startsAt without endsAt is active", () => {
    expect(isMaintenanceActive(m({ enabled: false, startsAt: iso(NOW - 1000) }), NOW)).toBe(true);
  });
  it("enabled with a past endsAt is not active", () => {
    expect(isMaintenanceActive(m({ enabled: true, endsAt: iso(NOW - 1000) }), NOW)).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  it("defaults to 3600", () => expect(retryAfterSeconds(m({}), NOW)).toBe(3600));
  it("clamps to a minimum of 60", () => expect(retryAfterSeconds(m({ returnAt: iso(NOW + 30_000) }), NOW)).toBe(60));
  it("clamps to a maximum of 86400", () => {
    expect(retryAfterSeconds(m({ returnAt: iso(NOW + 2 * 86_400_000) }), NOW)).toBe(86400);
  });
  it("rounds up in range", () => expect(retryAfterSeconds(m({ returnAt: iso(NOW + 600_000) }), NOW)).toBe(600));
  // M4: with no estimated return, a scheduled end is the next best guess (same clamp).
  it("falls back to endsAt when there is no returnAt", () => {
    expect(retryAfterSeconds(m({ endsAt: iso(NOW + 600_000) }), NOW)).toBe(600);
    expect(retryAfterSeconds(m({ endsAt: iso(NOW + 10_000) }), NOW)).toBe(60);
    expect(retryAfterSeconds(m({ endsAt: iso(NOW + 2 * 86_400_000) }), NOW)).toBe(86400);
  });
  it("prefers returnAt over endsAt", () => {
    expect(retryAfterSeconds(m({ returnAt: iso(NOW + 300_000), endsAt: iso(NOW + 900_000) }), NOW)).toBe(300);
  });
});

describe("parseSiteState", () => {
  it("only false turns a switch off", () => {
    const s = parseSiteState({ switches: { gas: false, pay: 0, donate: "no" } });
    expect(s.switches.gas).toBe(false);
    expect(SWITCH_KEYS.filter((k) => k !== "gas").every((k) => s.switches[k])).toBe(true);
  });
  it("garbage gives OPEN_STATE", () => {
    expect(parseSiteState("x")).toEqual(OPEN_STATE);
    expect(parseSiteState(null)).toEqual(OPEN_STATE);
  });
  it("reads maintenance, rejecting bad enabled and dates", () => {
    const s = parseSiteState({
      maintenance: {
        enabled: "true",
        mode: "custom",
        messageEs: "hola",
        messageEn: 3,
        returnAt: "nope",
        startsAt: "2099-01-01T10:00:00.000Z",
        endsAt: null,
      },
    });
    expect(s.maintenance).toEqual({
      enabled: false,
      mode: "custom",
      messageEs: "hola",
      messageEn: null,
      returnAt: null,
      startsAt: "2099-01-01T10:00:00.000Z",
      endsAt: null,
    });
  });
});
