import { describe, expect, it } from "vitest";
import { describeAdminAction, SWITCH_LABELS } from "@/lib/admin/labels";
import { SWITCH_KEYS } from "@/lib/admin/state";

const WALLET = "0x1234567890abcdef1234567890abcdef1234abcd";

describe("SWITCH_LABELS", () => {
  it("names the 10 switches with the spec's labels", () => {
    expect(Object.keys(SWITCH_LABELS).sort()).toEqual([...SWITCH_KEYS].sort());
    expect(SWITCH_LABELS).toEqual({
      giveaways: "Sorteos verificables",
      pay: "ElClub Pay",
      checker: "Comprobador",
      vouches: "Avales",
      approvals: "Aprobaciones",
      multisend: "Envío múltiple (incluye «Repartir gastos»)",
      gas: "Gas",
      donate: "Donar público",
      checkerApi: "API del comprobador",
      registration: "Registro de cuentas públicas",
    });
  });
});

describe("describeAdminAction", () => {
  it.each([
    ["admin.switch", { key: "gas", enabled: false }, "Desactivó «Gas»"],
    ["admin.switch", { key: "gas", enabled: true }, "Activó «Gas»"],
    ["admin.maintenance", { enabled: true, mode: "default", startsAt: null }, "Activó el mantenimiento"],
    ["admin.maintenance", { enabled: false, mode: "custom", startsAt: "2030-01-01T00:00:00.000Z" }, "Programó el mantenimiento"],
    ["admin.maintenance", { enabled: false, mode: "default", startsAt: null }, "Desactivó el mantenimiento"],
    ["admin.maintenance_password", {}, "Cambió la contraseña de mantenimiento"],
    ["admin.access_add", { wallet: WALLET, note: "Ana" }, "Añadió 0x1234…abcd a la lista de acceso"],
    ["admin.access_remove", { wallet: WALLET }, "Quitó 0x1234…abcd de la lista de acceso"],
    ["admin.something_new", {}, "admin.something_new"],
  ])("%s %j → %s", (action, payload, text) => {
    expect(describeAdminAction(action, payload)).toBe(text);
  });

  it("falls back to the code when the payload is unreadable", () => {
    expect(describeAdminAction("admin.switch", { key: "nope", enabled: false })).toBe("admin.switch");
    expect(describeAdminAction("admin.access_add", {})).toBe("admin.access_add");
  });
});
