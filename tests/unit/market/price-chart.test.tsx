import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriceChart } from "@/components/market/price-chart";
import type { ChartPoint } from "@/lib/market/types";

const pts: ChartPoint[] = [
  [1_000, 100],
  [2_000, 150],
  [3_000, 50],
  [4_000, 120],
];

describe("PriceChart", () => {
  it("draws a labelled area and line", () => {
    const { container } = render(<PriceChart name="Bitcoin" range="7" points={pts} />);
    expect(
      screen.getByRole("img", {
        name: "Precio de Bitcoin en 7 días: de 50,00 USD a 150,00 USD, último 120,00 USD",
      }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
  });

  it("states min, max and the signed change in a caption", () => {
    const { container } = render(<PriceChart name="Bitcoin" range="7" points={pts} />);
    const cap = container.querySelector("figcaption")!;
    expect(cap).toHaveTextContent("50,00 USD");
    expect(cap).toHaveTextContent("150,00 USD");
    expect(cap).toHaveTextContent("+20,00 %");
  });

  it("shows a negative change with its sign", () => {
    const { container } = render(
      <PriceChart
        name="X"
        range="1"
        points={[
          [1, 100],
          [2, 90],
        ]}
      />,
    );
    expect(container.querySelector("figcaption")).toHaveTextContent("-10,00 %");
  });

  it("says there is no data with fewer than 2 points", () => {
    render(<PriceChart name="Bitcoin" range="7" points={[[1, 1]]} />);
    expect(screen.getByText("Sin datos para este periodo.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does not divide by zero on a flat series", () => {
    const { container } = render(
      <PriceChart
        name="S"
        range="7"
        points={[
          [1, 1],
          [2, 1],
        ]}
      />,
    );
    expect(container.innerHTML).not.toContain("NaN");
  });
});
