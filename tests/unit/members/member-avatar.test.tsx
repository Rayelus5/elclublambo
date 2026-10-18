import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberAvatar } from "@/components/members/member-avatar";

const m = { handle: "ana", displayName: "Ana", walletAddress: "0x1234567890abcdef1234567890abcdef12345678", avatarPath: null };

describe("MemberAvatar", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"));
  afterEach(() => vi.unstubAllEnvs());

  it("renders the image when a path is set", () => {
    const { container } = render(<MemberAvatar member={{ ...m, avatarPath: "m1/a.png" }} size={32} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")!.endsWith("m1/a.png")).toBe(true);
    expect(img.getAttribute("alt")).toBe("");
  });

  it("renders an aria-hidden identicon svg otherwise", () => {
    const { container } = render(<MemberAvatar member={m} size={24} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
