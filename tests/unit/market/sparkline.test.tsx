import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "@/components/market/sparkline";

describe("Sparkline", () => {
  it("draws one polyline inside the box, labelled", () => {
    const { container } = render(<Sparkline points={[1, 3, 2, 5]} label="Tendencia 7 días de Bitcoin: sube" />);
    expect(screen.getByRole("img", { name: "Tendencia 7 días de Bitcoin: sube" })).toBeInTheDocument();
    const lines = container.querySelectorAll("polyline");
    expect(lines).toHaveLength(1);
    const pts = lines[0]!.getAttribute("points")!.split(" ").map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(4);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(32);
    }
    expect(pts[3]![1]).toBeLessThan(pts[0]![1]!); // higher value = smaller y
  });
  it("a flat series does not divide by zero", () => {
    const { container } = render(<Sparkline points={[2, 2, 2]} label="x" />);
    expect(container.querySelector("polyline")!.getAttribute("points")).not.toMatch(/NaN|Infinity/);
  });
  it("fewer than 2 points renders nothing", () => {
    const { container } = render(<Sparkline points={[1]} label="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});
