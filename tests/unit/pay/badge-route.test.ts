// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const getPublicProfileView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pay/queries", () => ({ getPublicProfileView }));

import { GET } from "@/app/(public)/[lang]/pay/[target]/badge/route";
import { colors } from "@/styles/tokens";
import { getDictionary } from "@/lib/i18n";

const call = (lang: string, target: string) =>
  GET(new Request("http://localhost/pay/x/badge"), { params: Promise.resolve({ lang, target }) });

const view = (alias: string) => ({ alias, displayName: null, address: "0x1", acceptNetworks: ["base"], isMember: false });

beforeEach(() => {
  getPublicProfileView.mockReset();
});

describe("GET badge", () => {
  it("an SVG with the alias and the localised text, cacheable for an hour", async () => {
    getPublicProfileView.mockResolvedValue(view("rayelus"));
    const res = await call("es", "rayelus");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("@rayelus");
    expect(svg).toContain(getDictionary("es").pay.tool.badgeText);
    expect(svg).toContain(colors.accent);
    expect(new TextEncoder().encode(svg).length).toBeLessThanOrEqual(2048);
    expect(getPublicProfileView).toHaveBeenCalledWith("rayelus");
  });

  it("uses the English text with lang=en", async () => {
    getPublicProfileView.mockResolvedValue(view("rayelus"));
    expect(await (await call("en", "rayelus")).text()).toContain("Pay with ElClub Pay");
  });

  it("escapes the alias text", async () => {
    getPublicProfileView.mockResolvedValue(view("<script>alert(1)</script>"));
    const svg = await (await call("en", "rayelus")).text();
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("a generic SVG, never a 500, for an unknown alias, an address or a failed read", async () => {
    getPublicProfileView.mockResolvedValue(null);
    for (const target of ["nobody"]) {
      const res = await call("en", target);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(await res.text()).not.toContain("@");
    }
    getPublicProfileView.mockResolvedValue({ ...view(""), alias: null });
    expect(await (await call("en", `0x${"1".repeat(40)}`)).text()).not.toContain("@");
    getPublicProfileView.mockReset().mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await call("en", "rayelus");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<svg");
  });
});
