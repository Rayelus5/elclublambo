import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarUrl, mentionLabel, memberName, type MemberIdentity } from "@/lib/members/name";

const W = "0x1234567890abcdef1234567890abcdef12345678";
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

describe("avatarUrl", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is null without a path", () => {
    expect(avatarUrl(null)).toBeNull();
  });
  it("builds the public storage URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(avatarUrl("m1/a.png")).toBe("http://127.0.0.1:54321/storage/v1/object/public/avatars/m1/a.png");
  });
});
