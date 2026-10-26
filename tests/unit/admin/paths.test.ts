import { describe, expect, it } from "vitest";
import { isMaintenanceBypass, isStatusPath, statusLang, toolForPath } from "../../../src/lib/admin/paths";

const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";
const HASH = "0x" + "ab12".repeat(16);

describe("toolForPath", () => {
  it.each([
    ["/herramientas/gas", "gas"],
    ["/en/tools/gas", "gas"],
    [`/herramientas/sorteos/${ID}/entries`, "giveaways"],
    ["/herramientas/sorteos", "giveaways"],
    [`/pay/tx/84532/${HASH}`, "pay"],
    ["/en/pay/ana", "pay"],
    ["/herramientas/pay", "pay"],
    ["/donar", "donate"],
    ["/en/donate", "donate"],
    ["/herramientas/comprobador/api", "checkerApi"],
    ["/api/v1/check/token", "checkerApi"],
    ["/herramientas/comprobador", "checker"],
    ["/herramientas/avales", "vouches"],
    [`/herramientas/sorteos/${ID}/opengraph-image`, "giveaways"],
    [`/herramientas/sorteos/${ID}/opengraph-image-1a2b`, "giveaways"],
    [`/herramientas/sorteos/${ID}/twitter-image-1a2b`, "giveaways"],
    [`/en/tools/giveaways/${ID}/opengraph-image-1a2b`, "giveaways"],
    [`/en/tools/giveaways/${ID}/twitter-image`, "giveaways"],
    ["/pay/ana/opengraph-image-1a2b", "pay"],
    ["/en/pay/ana/twitter-image-1a2b", "pay"],
    ["/herramientas/gas/opengraph-image-1a2b", "gas"],
    ["/opengraph-image-1a2b", null],
    ["/herramientas", null],
    ["/foro/donar", null],
    ["/", null],
  ])("%s -> %s", (p, k) => expect(toolForPath(p)).toBe(k));

  // M2: Next serves a static item by its decoded path, so a percent-encoded URL is the same tool.
  it.each([
    ["/en/tools/%67as", "gas"],
    ["/en/tools/%67%61%73", "gas"],
    ["/herramientas/%67as", "gas"],
    ["/%68erramientas/gas", "gas"],
    ["/en/%74ools/multisend", "multisend"],
    ["/%64onar", "donate"],
    ["/api/v1/%63heck/token", "checkerApi"],
  ])("decodes %s -> %s", (p, k) => expect(toolForPath(p)).toBe(k));

  it.each(["/en/tools/%E0%A4%A", "/herramientas/%zz", "/%"])("a malformed escape (%s) neither throws nor matches", (p) => {
    expect(toolForPath(p)).toBeNull();
  });
});

describe("isMaintenanceBypass", () => {
  it.each([
    ["/api/cron/dao", true],
    ["/api/cron", true],
    ["/api/cronx", false],
    ["/api/webhooks/x", true],
    ["/api/team-access", true],
    ["/robots.txt", true],
    ["/sitemap.xml", true],
    ["/es/opengraph-image-1a2b", true],
    ["/foro/login", false],
    ["/", false],
  ])("%s -> %s", (p, v) => expect(isMaintenanceBypass(p)).toBe(v));
});

describe("isStatusPath", () => {
  it("matches /status and below only", () => {
    expect(isStatusPath("/status")).toBe(true);
    expect(isStatusPath("/status/es/maintenance")).toBe(true);
    expect(isStatusPath("/statusx")).toBe(false);
  });
});

describe("statusLang", () => {
  it("follows A-R12", () => {
    expect(statusLang("/foro/c/x", "en-GB,en;q=0.9")).toBe("en");
    expect(statusLang("/", "en")).toBe("es");
    expect(statusLang("/en/tools", null)).toBe("en");
    expect(statusLang("/donar", "en")).toBe("es");
    expect(statusLang("/api/x", "es-ES")).toBe("es");
    expect(statusLang("/foro/x", null)).toBe("es");
  });
});
