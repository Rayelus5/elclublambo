import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarUrl, hasFriendlyName, mentionLabel, memberName, type MemberIdentity } from "@/lib/members/name";

const W = "0x1234567890abcdef1234567890abcdef12345678";
const PATH = "3f2b8c1e-0a4d-4b7e-9c11-2d5e6f708192/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.png";
const base: MemberIdentity = { handle: null, displayName: null, walletAddress: W, avatarPath: null };

describe("memberName", () => {
  it("prefers the trimmed display name", () => {
    expect(memberName({ ...base, displayName: "  Ana ", handle: "ana_l" })).toBe("Ana");
  });
  it("falls back to @handle", () => {
    expect(memberName({ ...base, handle: "ana_l" })).toBe("@ana_l");
    expect(memberName({ ...base, displayName: "   ", handle: "ana_l" })).toBe("@ana_l");
  });
  it("falls back to the short wallet", () => {
    expect(memberName(base)).toBe("0x1234…5678");
  });
});

describe("mentionLabel", () => {
  it("uses @handle when present", () => {
    expect(mentionLabel({ ...base, displayName: "Ana", handle: "ana_l" })).toBe("@ana_l");
  });
  it("falls back to @ + memberName", () => {
    expect(mentionLabel({ ...base, displayName: "Ana" })).toBe("@Ana");
    expect(mentionLabel(base)).toBe("@0x1234…5678");
  });
});

describe("hasFriendlyName", () => {
  it("is true for a non-blank display name or a handle", () => {
    expect(hasFriendlyName({ ...base, displayName: "Ana" })).toBe(true);
    expect(hasFriendlyName({ ...base, handle: "ana_l" })).toBe(true);
    expect(hasFriendlyName({ ...base, displayName: "   " })).toBe(false);
    expect(hasFriendlyName(base)).toBe(false);
  });
});

describe("avatarUrl", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is null without a path", () => {
    expect(avatarUrl(null)).toBeNull();
  });
  it("builds the public storage URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(avatarUrl(PATH)).toBe(`http://127.0.0.1:54321/storage/v1/object/public/avatars/${PATH}`);
    expect(avatarUrl(PATH.replace(".png", ".jpg"))).not.toBeNull();
    expect(avatarUrl(PATH.replace(".png", ".webp"))).not.toBeNull();
  });
  it("rejects anything that is not <uuid>/<uuid>.(png|jpg|webp)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    for (const bad of ["m1/a.png", "../x.png", `${PATH}.gif`, PATH.replace(".png", ".jpeg"), `x/${PATH}`, `${PATH}?a=1`, `${PATH.split("/")[0]}/../${PATH.split("/")[1]}`]) {
      expect(avatarUrl(bad)).toBeNull();
    }
  });
  it("is null when the Supabase URL is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(avatarUrl(PATH)).toBeNull();
  });
});
