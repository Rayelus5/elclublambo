import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberAvatar } from "@/components/members/member-avatar";

const PATH = "3f2b8c1e-0a4d-4b7e-9c11-2d5e6f708192/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.png";
const m = { handle: "ana", displayName: "Ana", walletAddress: "0x1234567890abcdef1234567890abcdef12345678", avatarPath: null };

describe("MemberAvatar", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"));
  afterEach(() => vi.unstubAllEnvs());

  it("renders the image when a path is set", () => {
    const { container } = render(<MemberAvatar member={{ ...m, avatarPath: PATH }} size={32} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")!.endsWith(PATH)).toBe(true);
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to the identicon when the image fails to load", () => {
    const { container } = render(<MemberAvatar member={{ ...m, avatarPath: PATH }} size={32} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders an aria-hidden identicon svg otherwise", () => {
    const { container } = render(<MemberAvatar member={m} size={24} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
