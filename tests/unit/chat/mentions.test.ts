import { describe, expect, it, vi } from "vitest";
import {
  buildMentionItems,
  composerKeyAction,
  filterSlashCommands,
  loadMentionItems,
  MENTION_LIMIT,
} from "@/lib/chat/mentions";

const ROLE = "22222222-2222-4222-8222-222222222222";
const M1 = "44444444-4444-4444-8444-444444444444";

describe("buildMentionItems", () => {
  it("excludes @everyone without permission", () => {
    const items = buildMentionItems({ query: "ev", members: [], roles: [], canMentionEveryone: false });
    expect(items.some((i) => i.kind === "everyone")).toBe(false);
  });

  it("offers @everyone first when allowed and it matches the query", () => {
    const items = buildMentionItems({ query: "", members: [], roles: [{ id: ROLE, label: "Admin" }], canMentionEveryone: true });
    expect(items[0]).toMatchObject({ kind: "everyone", id: null, label: "everyone" });
    expect(items[1]).toMatchObject({ kind: "role", id: ROLE, label: "Admin" });
  });

  it("hides @everyone when the query does not match it", () => {
    const items = buildMentionItems({ query: "zzz", members: [], roles: [], canMentionEveryone: true });
    expect(items).toEqual([]);
  });

  it("lists members before roles and caps the total", () => {
    const members = Array.from({ length: 8 }, (_, i) => ({ id: M1, label: `m${i}`, walletAddress: "0x1" }));
    const roles = Array.from({ length: 8 }, (_, i) => ({ id: ROLE, label: `r${i}` }));
    const items = buildMentionItems({ query: "", members, roles, canMentionEveryone: true });
    expect(items.length).toBe(MENTION_LIMIT);
    expect(items[0]!.kind).toBe("everyone");
    expect(items[1]!.kind).toBe("member");
  });

  it("falls back to a short wallet when a member has no display name", () => {
    const items = buildMentionItems({
      query: "0x",
      members: [{ id: M1, label: "", walletAddress: "0x1234567890abcdef1234567890abcdef12345678" }],
      roles: [],
      canMentionEveryone: false,
    });
    expect(items[0]!.label).toBe("0x1234…5678");
  });

  it("keys a member with a handle by the handle and hints the display name or wallet", () => {
    const items = buildMentionItems({
      query: "ana",
      members: [
        { id: M1, label: "Ana", handle: "ana_l", walletAddress: "0x1234567890abcdef1234567890abcdef12345678" },
        { id: M1, label: "", handle: "bob", walletAddress: "0x1234567890abcdef1234567890abcdef12345678" },
      ],
      roles: [],
      canMentionEveryone: false,
    });
    expect(items[0]).toMatchObject({ label: "ana_l", handle: true, hint: "Ana" });
    expect(items[1]).toMatchObject({ label: "bob", handle: true, hint: "0x1234…5678" });
  });
});

describe("loadMentionItems", () => {
  it("queries the server and applies the permission filter", async () => {
    const search = vi.fn(async () => ({ members: [{ id: M1, label: "Ana", walletAddress: "0x1" }], roles: [{ id: ROLE, label: "Everyone-fans" }] }));
    const without = await loadMentionItems("e", { canMentionEveryone: false, search });
    expect(without.map((i) => i.kind)).toEqual(["member", "role"]);
    const withPerm = await loadMentionItems("e", { canMentionEveryone: true, search });
    expect(withPerm.map((i) => i.kind)).toEqual(["everyone", "member", "role"]);
  });

  it("returns nothing when the search fails", async () => {
    const search = vi.fn(async () => {
      throw new Error("x");
    });
    expect(await loadMentionItems("a", { canMentionEveryone: false, search })).toEqual([]);
  });
});

describe("composerKeyAction", () => {
  const base = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false };
  it("compact: Enter sends, Shift+Enter does not", () => {
    expect(composerKeyAction(base, { expanded: false, suggestionOpen: false })).toBe("send");
    expect(composerKeyAction({ ...base, shiftKey: true }, { expanded: false, suggestionOpen: false })).toBe("default");
  });
  it("never sends while a suggestion popup is open or IME is composing", () => {
    expect(composerKeyAction(base, { expanded: false, suggestionOpen: true })).toBe("default");
    expect(composerKeyAction({ ...base, isComposing: true }, { expanded: false, suggestionOpen: false })).toBe("default");
    expect(composerKeyAction({ ...base, key: "Process" }, { expanded: false, suggestionOpen: false })).toBe("default");
  });
  it("expanded: plain Enter is a newline, Ctrl/Cmd+Enter sends", () => {
    expect(composerKeyAction(base, { expanded: true, suggestionOpen: false })).toBe("default");
    expect(composerKeyAction({ ...base, ctrlKey: true }, { expanded: true, suggestionOpen: false })).toBe("send");
    expect(composerKeyAction({ ...base, metaKey: true }, { expanded: true, suggestionOpen: false })).toBe("send");
  });
  it("ignores other keys", () => {
    expect(composerKeyAction({ ...base, key: "a" }, { expanded: false, suggestionOpen: false })).toBe("default");
  });
});

describe("filterSlashCommands", () => {
  it("hides /imagen without attach permission and /alpha without a handler", () => {
    expect(filterSlashCommands("", { canAttach: false, hasAlpha: false }).map((c) => c.id)).toEqual(["codigo"]);
    expect(filterSlashCommands("", { canAttach: true, hasAlpha: true }).map((c) => c.id)).toEqual(["alpha", "imagen", "codigo"]);
  });
  it("filters by prefix, ignoring case and accents", () => {
    expect(filterSlashCommands("CÓ", { canAttach: true, hasAlpha: true }).map((c) => c.id)).toEqual(["codigo"]);
    expect(filterSlashCommands("im", { canAttach: false, hasAlpha: true })).toEqual([]);
  });
});
