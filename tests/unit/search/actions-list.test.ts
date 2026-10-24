import { describe, expect, it } from "vitest";
import { buildActions, messageHref } from "@/lib/search/actions-list";
import { Perm } from "@/lib/permissions/bits";

const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as const;
const base = { perms: 0n, canReports: false, ticketChannels: [], wallet: WALLET };
const ids = (a: ReturnType<typeof buildActions>) => a.map((x) => x.id);
const href = (a: ReturnType<typeof buildActions>, id: string) => a.find((x) => x.id === id)?.href;

describe("buildActions", () => {
  it("always offers mentions, tickets, the guide and profile", () => {
    const a = buildActions(base);
    expect(ids(a)).toEqual(["mentions", "tickets", "guide", "guide:propinas", "guide:bounties", "guide:donaciones", "guide:sorteos", "guide:encuestas", "guide:candados", "guide:redes", "donate", "giveaways", "market", "profile"]);
    expect(href(a, "market")).toBe("/mercado");
    expect(a.find((x) => x.id === "market")?.label).toBe("Mercado");
    expect(href(a, "donate")).toBe("/donar");
    expect(a.find((x) => x.id === "donate")?.label).toBe("Donar a ElClub.");
    expect(href(a, "guide")).toBe("/guia");
    expect(href(a, "guide:donaciones")).toBe("/guia/donaciones");
    expect(href(a, "mentions")).toBe("/notifications?filter=mentions");
    expect(href(a, "tickets")).toBe("/tickets");
    expect(href(a, "profile")).toBe(`/u/${WALLET}`);
  });
  it("the polls guide entry has no weight keywords", () => {
    const kw = buildActions(base).find((x) => x.id === "guide:encuestas")?.keywords ?? "";
    expect(kw).toContain("encuesta");
    expect(kw).not.toMatch(/participaciones|peso/);
  });
  it("create invite needs CREATE_INVITES", () => {
    expect(href(buildActions({ ...base, perms: Perm.CREATE_INVITES }), "invite")).toBe("/invites");
    expect(ids(buildActions({ ...base, perms: Perm.SEND_MESSAGES }))).not.toContain("invite");
  });
  it("settings needs MANAGE_CHANNELS or MANAGE_ROLES", () => {
    expect(href(buildActions({ ...base, perms: Perm.MANAGE_CHANNELS }), "settings")).toBe("/settings");
    expect(ids(buildActions({ ...base, perms: Perm.MANAGE_ROLES }))).toContain("settings");
    expect(ids(buildActions({ ...base, perms: Perm.BAN_MEMBERS }))).not.toContain("settings");
  });
  it("members needs BAN_MEMBERS or VERIFY_MEMBERS", () => {
    expect(href(buildActions({ ...base, perms: Perm.BAN_MEMBERS }), "members")).toBe("/admin/members");
    expect(ids(buildActions({ ...base, perms: Perm.VERIFY_MEMBERS }))).toContain("members");
    expect(ids(buildActions({ ...base, perms: Perm.MANAGE_ROLES }))).not.toContain("members");
  });
  it("reports follows canReports only", () => {
    expect(href(buildActions({ ...base, canReports: true }), "reports")).toBe("/moderation/reports");
    expect(ids(buildActions({ ...base, perms: Perm.MANAGE_MESSAGES }))).not.toContain("reports");
  });
  it("administrator gets every permission-gated action", () => {
    expect(ids(buildActions({ ...base, perms: Perm.ADMINISTRATOR }))).toEqual(expect.arrayContaining(["invite", "settings", "members"]));
  });
  it("one open-ticket action per ticket channel", () => {
    const a = buildActions({ ...base, ticketChannels: [{ id: "c1", name: "soporte" }, { id: "c2", name: "ayuda" }] });
    expect(a.filter((x) => x.id.startsWith("ticket:")).map((x) => [x.label, x.href])).toEqual([
      ["Abrir ticket en #soporte", "/c/c1?openTicket=1"],
      ["Abrir ticket en #ayuda", "/c/c2?openTicket=1"],
    ]);
  });
});

describe("messageHref", () => {
  const C = "11111111-1111-4111-8111-111111111111";
  const R = "22222222-2222-4222-8222-222222222222";
  const M = "33333333-3333-4333-8333-333333333333";
  it("root message", () => {
    expect(messageHref({ channelId: C, id: M, threadRootId: null }, "abc12")).toBe(`/c/${C}?m=${M}&h=abc12`);
  });
  it("reply opens its thread", () => {
    expect(messageHref({ channelId: C, id: M, threadRootId: R }, "abc12")).toBe(`/c/${C}?thread=${R}&m=${M}&h=abc12`);
  });
});

describe("buildActions · giveaways (P1)", () => {
  it("offers «Sorteos» to every member", () => {
    const g = buildActions(base).find((x) => x.id === "giveaways");
    expect(g).toMatchObject({ label: "Sorteos", href: "/sorteos", icon: "giveaways" });
    expect(g?.keywords).toContain("sorteo");
  });
});

describe("buildActions · donations (P1)", () => {
  it("offers «Donar a ElClub.» with its keywords and no DAO entry", () => {
    const a = buildActions(base);
    const donate = a.find((x) => x.id === "donate");
    expect(donate).toMatchObject({ label: "Donar a ElClub.", href: "/donar" });
    expect(donate?.keywords).toContain("donar mecenas donación");
    expect(ids(a)).not.toContain("dao");
    expect(a.filter((x) => !x.id.startsWith("guide:")).some((x) => /DAO/.test(x.label) || x.href.startsWith("/dao"))).toBe(false);
  });
});
