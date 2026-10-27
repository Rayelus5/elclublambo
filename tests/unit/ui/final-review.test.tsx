import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: vi.fn(async () => ({ data: null, error: null })) }) }));
vi.mock("@/lib/roles/actions", () => ({
  createRoleAction: vi.fn(),
  updateRoleAction: vi.fn(),
  deleteRoleAction: vi.fn(),
  moveRoleAction: vi.fn(),
}));

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ROLE_COLOR_PALETTE } from "@/components/settings/role-form";
import { colors, contrastRatio } from "@/styles/tokens";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const srcFiles = () => walk(join(ROOT, "src")).filter((p) => /\.(tsx?|css)$/.test(p));
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const words = (c: string) => c.split(/\s+/);

// R2 final review: one Base Blue fill per screen, AA on every hover, no old palette.
describe("R2 final review", () => {
  it("the signed-out giveaways list asks for an outline connect button (its CTA is the one fill)", () => {
    const src = read("src/app/(public)/[lang]/tools/giveaways/page.tsx");
    expect(src).toMatch(/<PublicConnectLazy[^>]*variant="outline"/);
  });

  it("the checked checkbox is Cerulean with dark text, never the brand fill", () => {
    render(<Checkbox defaultChecked aria-label="x" />);
    const cls = screen.getByRole("checkbox").className;
    expect(words(cls)).toContain("data-checked:bg-accent");
    expect(words(cls)).toContain("data-checked:text-accent-foreground");
    expect(cls).not.toMatch(/data-checked:bg-primary|accent-fill/);
  });

  it.each([
    "src/components/treasury/treasurer/withdrawals-table.tsx",
    "src/components/giveaways/treasurer-actions.tsx",
    "src/components/giveaways/mark-paid-dialog.tsx",
  ])("per-row buttons in %s are not the brand fill", (file) => {
    const tags = read(file).match(/<Button\b[^>]*>/g) ?? [];
    const rowTags = tags.filter((t) => /size="sm"/.test(t));
    expect(rowTags.length).toBeGreaterThan(0);
    for (const t of rowTags) expect(t).toMatch(/variant="(outline|secondary)"/);
  });

  it("no text hover uses an opacity that can fall below AA", () => {
    const offenders = srcFiles()
      .filter((p) => /hover:text-[a-z0-9-]+\/\d+/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the destructive Button hovers to a solid danger-hover with AA text", () => {
    render(<Button variant="destructive">Borrar</Button>);
    const cls = screen.getByRole("button", { name: "Borrar" }).className;
    expect(words(cls)).toContain("hover:bg-danger-hover");
    expect(cls).not.toMatch(/danger\/\d+/);
    expect(contrastRatio(colors.bg, colors.dangerHover)).toBeGreaterThanOrEqual(4.5);
  });

  it("no source hardcodes a colour of the old palette", () => {
    const old = /#(0A0A0A|111111|171717|262626|3A3A3A|EDEDED|A3A3A3|3DDC84|FFB020|FF5A5A|61DFFF)\b/i;
    const offenders = srcFiles()
      .filter((p) => old.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the role colour palette is made of Base palette colours", () => {
    expect([...ROLE_COLOR_PALETTE].map((c) => c.toUpperCase())).toEqual([
      "#3C8AFF", "#66C800", "#FFD12F", "#FC401F", "#FEA8CD", "#B8A581", "#B6F569", "#EEF0F3", "#B1B7C3",
    ]);
  });

  it("the Base network icon is the round one, like the other network logos: Base Blue circle with the white Square (user's choice, 2026-10-25)", () => {
    const p = join(ROOT, "public/brand/networks/base.svg");
    expect(existsSync(p)).toBe(true);
    const svg = readFileSync(p, "utf8");
    expect(svg).toMatch(/<circle cx="640" cy="640" r="640" fill="#0000FF"\/>/);
    expect(svg).toMatch(/<path fill="#FFFFFF"/);
    expect(svg).toContain("M0,101.12c0-34.64");
  });
});
