import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RangeTabs } from "@/components/market/range-tabs";

describe("RangeTabs", () => {
  it("links the four ranges and marks the active one", () => {
    render(<RangeTabs id="bitcoin" active="30" />);
    const expected: [string, string][] = [
      ["24 h", "?r=1"],
      ["7 d", "?r=7"],
      ["30 d", "?r=30"],
      ["1 a", "?r=365"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/mercado/bitcoin${href}`);
    }
    expect(screen.getByRole("link", { name: "30 d" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "7 d" })).not.toHaveAttribute("aria-current");
  });

  it("keeps every target at least 44px tall", () => {
    render(<RangeTabs id="bitcoin" active="7" />);
    for (const a of screen.getAllByRole("link")) expect(a.className).toContain("min-h-11");
  });

  // T-003: on a phone the four ranges share the full width as one segmented control (big thumb targets).
  it("spreads the ranges over the full width on narrow screens", () => {
    render(<RangeTabs id="bitcoin" active="7" />);
    const nav = screen.getByRole("navigation", { name: "Periodo del gráfico" });
    expect(nav).toHaveClass("grid", "grid-cols-4", "sm:inline-grid");
    for (const a of screen.getAllByRole("link")) expect(a).toHaveClass("min-w-11");
  });
});
