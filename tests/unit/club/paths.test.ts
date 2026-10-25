import { describe, expect, it } from "vitest";
import { CLUB_BASE, clubPath, clubRelative } from "@/lib/club/paths";

describe("clubPath", () => {
  it("is /foro", () => {
    expect(CLUB_BASE).toBe("/foro");
  });

  it("prefixes club paths with /foro, keeping query and hash", () => {
    expect(clubPath()).toBe("/foro");
    expect(clubPath("/")).toBe("/foro");
    expect(clubPath("/c/x?m=1")).toBe("/foro/c/x?m=1");
    expect(clubPath("/u/0xabc#top")).toBe("/foro/u/0xabc#top");
    expect(clubPath("/?x=1")).toBe("/foro?x=1");
    expect(clubPath("settings/roles")).toBe("/foro/settings/roles");
  });

  it("is idempotent", () => {
    expect(clubPath("/foro")).toBe("/foro");
    expect(clubPath("/foro/c/x?m=1")).toBe("/foro/c/x?m=1");
    expect(clubPath(clubPath("/tickets/1"))).toBe("/foro/tickets/1");
    expect(clubPath("/foro?x=1")).toBe("/foro?x=1");
  });

  it("does not mistake a lookalike segment for the base", () => {
    expect(clubPath("/foros")).toBe("/foro/foros");
  });
});

describe("clubRelative", () => {
  it("strips the base from a club pathname", () => {
    expect(clubRelative("/foro")).toBe("/");
    expect(clubRelative("/foro/")).toBe("/");
    expect(clubRelative("/foro/c/x")).toBe("/c/x");
  });

  it("is null outside the club", () => {
    expect(clubRelative("/")).toBeNull();
    expect(clubRelative("/c/x")).toBeNull();
    expect(clubRelative("/foros/x")).toBeNull();
    expect(clubRelative("/herramientas")).toBeNull();
  });
});
