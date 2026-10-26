import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => null }));
vi.mock("wagmi", () => ({ useDisconnect: () => ({ disconnect: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: vi.fn(async () => ({ data: null, error: null })) }) }));
vi.mock("@/lib/roles/actions", () => ({
  createRoleAction: vi.fn(),
  updateRoleAction: vi.fn(),
  deleteRoleAction: vi.fn(),
  moveRoleAction: vi.fn(),
}));

import { Button } from "@/components/ui/button";
import { PublicHeader } from "@/components/public/public-header";
import { ROLE_COLOR_PALETTE } from "@/components/settings/role-form";
import { ChatDensityProvider, DensityToggle } from "@/components/chat/density";
import { UiZoomToggle } from "@/components/profile/ui-zoom-toggle";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Tailwind classes of a token, as whole words (so `bg-accent` does not match `bg-accent-fill`). */
const hasClass = (className: string, cls: string) => className.split(/\s+/).includes(cls);

describe("brand fill (Base Blue + white) vs Cerulean", () => {
  it("the default Button is the brand fill with white text and a Cerulean focus ring", () => {
    render(<Button>Enviar</Button>);
    const cls = screen.getByRole("button", { name: "Enviar" }).className;
    expect(hasClass(cls, "bg-accent-fill") || hasClass(cls, "bg-primary")).toBe(true);
    expect(hasClass(cls, "text-accent-fill-fg") || hasClass(cls, "text-primary-foreground")).toBe(true);
    expect(hasClass(cls, "bg-accent")).toBe(false);
    expect(hasClass(cls, "focus-visible:ring-accent")).toBe(true);
  });

  it("the public header wordmark square is Cerulean, never Base Blue", () => {
    render(<PublicHeader lang="es" session={null} />);
    const home = screen.getAllByRole("link").find((a) => a.textContent?.includes("ElClub"));
    const square = home?.querySelector("span[aria-hidden]");
    expect(square).toBeTruthy();
    expect(hasClass(square!.className, "bg-accent")).toBe(true);
    expect(square!.className).not.toContain("accent-fill");
    expect(square!.className).not.toContain("bg-primary");
  });

  it.each(["src/components/start/hero.tsx", "src/components/start/final-cta.tsx", "src/components/shell/sidebar.tsx", "src/components/shell/topbar.tsx"])(
    "the wordmark in %s never uses the brand fill",
    (file) => {
      const src = read(file);
      expect(src).not.toMatch(/accent-fill|bg-primary/);
    },
  );

  it("the /start hero growing square is Cerulean", () => {
    const src = read("src/components/start/hero.tsx");
    expect(src).toMatch(/ref=\{dot\}[^>]*className="[^"]*\bbg-accent\b(?!-)/);
  });

  it("no file in src or public hardcodes Base Blue (#0000FF, #00f, rgb(0,0,255)) outside globals.css and styles/tokens.ts", () => {
    // Base's own network icon draws Base's brand colour (it is their mark, not our token).
    const allowed = new Set([
      join("src", "app", "globals.css"),
      join("src", "styles", "tokens.ts"),
      join("public", "brand", "networks", "base.svg"),
      // ElClub.'s own logo is drawn in Base Blue (it is the owner's mark, not a token).
      join("public", "brand", "logo", "elclub-logo-1.svg"),
      join("public", "brand", "logo", "elclub-logo-2.svg"),
    ]);
    const blue = /#0000ff\b|#00f\b|rgba?\(\s*0\s*,\s*0\s*,\s*255\s*[,)]/i;
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "public"))].filter((p) => !/\.(png|ico|woff2?|jpe?g|webp)$/i.test(p));
    const offenders = files
      .map((p) => relative(ROOT, p))
      .filter((p) => !allowed.has(p))
      .filter((p) => blue.test(readFileSync(join(ROOT, p), "utf8")));
    expect(offenders.map((p) => p.split(sep).join("/"))).toEqual([]);
  });

  it("OG images draw the wordmark square with colors.accent, never colors.accentFill", () => {
    const ogs = walk(join(ROOT, "src", "app", "(public)", "[lang]")).filter((p) => p.endsWith("opengraph-image.tsx"));
    expect(ogs.length).toBeGreaterThanOrEqual(4);
    for (const p of ogs) {
      const src = readFileSync(p, "utf8");
      expect(src).toMatch(/width: 14, height: 14, background: colors\.accent \}/);
      expect(src).not.toContain("colors.accentFill");
    }
  });

  it("the pay badge (a drawn button) is the brand fill with white text", () => {
    const src = read("src/app/(public)/[lang]/pay/[target]/badge/route.ts");
    expect(src).toContain('fill="${colors.accentFill}"');
    expect(src).toContain('fill="${colors.accentFillFg}"');
  });

  it("the default Button hovers to a solid darker Base Blue, not a transparency", () => {
    render(<Button>Hover</Button>);
    const cls = screen.getByRole("button", { name: "Hover" }).className;
    expect(hasClass(cls, "hover:bg-accent-fill-hover")).toBe(true);
    expect(cls).not.toMatch(/accent-fill\/\d+/);
  });

  it("no brand fill uses a translucent hover (opacity or /NN)", () => {
    const offenders = walk(join(ROOT, "src"))
      .filter((p) => /\.tsx?$/.test(p))
      .filter((p) => {
        const src = readFileSync(p, "utf8");
        return /accent-fill\/\d+/.test(src) || /bg-accent-fill[^"`]*hover:opacity-/.test(src);
      })
      .map((p) => relative(ROOT, p).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("selected segmented chips are Cerulean, not the brand fill (one Base Blue fill per screen)", () => {
    render(
      <ChatDensityProvider initial="standard">
        <DensityToggle />
        <UiZoomToggle />
      </ChatDensityProvider>,
    );
    const selected = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true");
    expect(selected.length).toBeGreaterThanOrEqual(2);
    for (const chip of selected) {
      expect(hasClass(chip.className, "bg-accent")).toBe(true);
      expect(hasClass(chip.className, "text-accent-foreground")).toBe(true);
      expect(chip.className).not.toContain("accent-fill");
    }
  });

  it.each([
    "src/components/chat/density.tsx",
    "src/components/giveaways/prize-editor.tsx",
    "src/components/profile/ui-zoom-toggle.tsx",
    "src/components/public-giveaways/prize-rows.tsx",
    "src/components/settings/channel-gate-form.tsx",
  ])("the segmented chips in %s never use the brand fill", (file) => {
    expect(read(file)).not.toContain("accent-fill");
  });

  it("the checked checkbox has no Base Blue border", () => {
    const src = read("src/components/ui/checkbox.tsx");
    expect(src).toContain("data-checked:border-transparent");
    expect(src).not.toMatch(/border-primary/);
  });

  it("the role colour palette offers Cerulean instead of the old cyan", () => {
    expect(ROLE_COLOR_PALETTE).toContain("#3C8AFF");
    expect(ROLE_COLOR_PALETTE).not.toContain("#61DFFF");
  });

  it.each([
    "src/app/(public)/[lang]/tools/giveaways/page.tsx",
    "src/components/landing/final-cta.tsx",
    "src/components/landing/pay-demo.tsx",
    "src/components/members/member-card.tsx",
    "src/components/public-donations/public-donate-panel.tsx",
  ])("the primary call to action in %s is the brand fill", (file) => {
    const src = read(file);
    expect(src).toContain("bg-accent-fill");
    expect(src).toContain("text-accent-fill-fg");
  });
});
