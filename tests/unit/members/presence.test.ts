import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetTab, otherLiveTabs, parsePresenceEvent, rememberTab, sendLeave } from "@/lib/members/presence";

beforeEach(() => localStorage.clear());

describe("tab registry", () => {
  it("knows whether another tab of this browser is still alive", () => {
    rememberTab("a", 1_000_000);
    rememberTab("b", 1_000_000);
    expect(otherLiveTabs("a", 1_010_000)).toBe(true);
    forgetTab("b");
    expect(otherLiveTabs("a", 1_010_000)).toBe(false);
  });

  it("ignores tabs that stopped beating (crashed) and survives junk", () => {
    rememberTab("old", 1_000_000);
    expect(otherLiveTabs("me", 1_000_000 + 60_000)).toBe(false);
    localStorage.setItem("elclub:presence-tabs", "{nope");
    expect(otherLiveTabs("me", 1_000_000)).toBe(false);
  });
});

describe("parsePresenceEvent", () => {
  it("accepts only a member uuid and a boolean", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parsePresenceEvent({ member_id: id, online: true, id: "x" })).toEqual({ memberId: id, online: true });
    expect(parsePresenceEvent({ member_id: "nope", online: true })).toBeNull();
    expect(parsePresenceEvent({ member_id: id, online: "yes" })).toBeNull();
    expect(parsePresenceEvent(null)).toBeNull();
  });
});

describe("sendLeave", () => {
  it("posts leave_presence with the session token as a keepalive request (survives the tab closing)", () => {
    const fetchSpy = vi.fn(async () => new Response(null));
    sendLeave({ url: "https://sb.example", anonKey: "anon", token: "tok" }, fetchSpy as never);
    expect(fetchSpy).toHaveBeenCalledWith("https://sb.example/rest/v1/rpc/leave_presence", {
      method: "POST",
      keepalive: true,
      headers: { apikey: "anon", Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("does nothing without a session token", () => {
    const fetchSpy = vi.fn();
    sendLeave({ url: "https://sb.example", anonKey: "anon", token: null }, fetchSpy as never);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
