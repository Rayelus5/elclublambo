import { describe, expect, it } from "vitest";
import { gateDecision, type GateInput } from "../../../src/lib/admin/gate";
import { OPEN_STATE, type SiteState } from "../../../src/lib/admin/state";

const NOW = Date.parse("2030-01-01T12:00:00.000Z");
const MAINT: SiteState = { ...OPEN_STATE, maintenance: { ...OPEN_STATE.maintenance, enabled: true } };
const GAS_OFF: SiteState = { ...OPEN_STATE, switches: { ...OPEN_STATE.switches, gas: false } };
const API_OFF: SiteState = { ...OPEN_STATE, switches: { ...OPEN_STATE.switches, checkerApi: false } };
const g = (o: Partial<GateInput>) =>
  gateDecision({ pathname: "/", method: "GET", rsc: false, state: OPEN_STATE, now: NOW, access: "none", ...o });

describe("maintenance", () => {
  it("shows the page to anonymous visitors", () => expect(g({ state: MAINT })).toEqual({ kind: "maintenancePage" }));
  it("answers JSON to a POST", () => {
    expect(g({ state: MAINT, method: "POST", pathname: "/herramientas/gas" })).toEqual({ kind: "maintenanceJson" });
  });
  it("answers JSON to /api GET", () => expect(g({ state: MAINT, pathname: "/api/x" })).toEqual({ kind: "maintenanceJson" }));
  it("RSC requests still get the page", () => expect(g({ state: MAINT, rsc: true })).toEqual({ kind: "maintenancePage" }));
  it("status paths are 404 even in maintenance", () => {
    expect(g({ state: MAINT, pathname: "/status/es/maintenance" })).toEqual({ kind: "status404" });
  });
  it("bypass paths pass", () => {
    expect(g({ state: MAINT, method: "POST", pathname: "/api/cron/dao" })).toEqual({ kind: "pass", banner: false });
  });
  it("granted access passes with banner", () => {
    expect(g({ state: MAINT, access: "granted" })).toEqual({ kind: "pass", banner: true });
    expect(g({ state: MAINT, access: "superadmin" })).toEqual({ kind: "pass", banner: true });
  });
  it("an expired window does not block", () => {
    const s = { ...MAINT, maintenance: { ...MAINT.maintenance, endsAt: new Date(NOW).toISOString() } };
    expect(g({ state: s })).toEqual({ kind: "pass", banner: false });
  });
});

describe("switches", () => {
  it("cuts the document load", () => {
    expect(g({ state: GAS_OFF, pathname: "/herramientas/gas" })).toEqual({ kind: "unavailablePage" });
  });
  it("lets RSC navigation through", () => {
    expect(g({ state: GAS_OFF, pathname: "/herramientas/gas", rsc: true })).toEqual({ kind: "pass", banner: false });
  });
  it("lets server actions through", () => {
    expect(g({ state: GAS_OFF, pathname: "/herramientas/gas", method: "POST" })).toEqual({ kind: "pass", banner: false });
  });
  it("cuts the check API for any method", () => {
    expect(g({ state: API_OFF, pathname: "/api/v1/check/token", method: "POST" })).toEqual({ kind: "unavailableJson" });
  });
  it("does not exempt the superadmin", () => {
    expect(g({ state: GAS_OFF, pathname: "/herramientas/gas", access: "superadmin" })).toEqual({ kind: "unavailablePage" });
  });
});
