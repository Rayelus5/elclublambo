import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BalanceChart, ShareDonut, ShareRing } from "@/components/treasury/dao-charts";

describe("ShareDonut", () => {
  it("draws one arc per slice and a legend with every label and percentage in text", () => {
    render(
      <ShareDonut
        donors={7}
        slices={[
          { key: "a", label: "@ana", bps: 6000, color: "var(--chart-1)" },
          { key: "b", label: "#2 Anónimo", bps: 2550, color: "var(--chart-2)" },
          { key: "rest", label: "Resto", bps: 1450, color: "var(--chart-rest)" },
        ]}
      />,
    );
    const img = screen.getByRole("img", { name: /Reparto de la DAO: @ana 60 %, #2 Anónimo 25,5 %, Resto 14,5 %/ });
    expect(img.querySelectorAll("circle[data-slice]")).toHaveLength(3);
    const legend = screen.getByRole("list", { name: "Leyenda del reparto" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["@ana60 %", "#2 Anónimo25,5 %", "Resto14,5 %"]);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows an empty state without donors", () => {
    render(<ShareDonut donors={0} slices={[]} />);
    expect(screen.getByText("Aún no hay aportaciones.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("BalanceChart", () => {
  it("summarises the trend for screen readers and labels the axis ends", () => {
    render(
      <BalanceChart
        points={[
          { at: "2026-10-17T12:00:00Z", usdc: 0 },
          { at: "2026-10-17T12:00:00Z", usdc: 10 },
          { at: "2026-10-18T12:00:00Z", usdc: 25.5 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /Balance de la tesorería: de 0 USDC a 25,5 USDC/ })).toBeInTheDocument();
    expect(screen.getByText("25,5 USDC")).toBeInTheDocument();
  });

  it("shows an empty state with no history", () => {
    render(<BalanceChart points={[]} />);
    expect(screen.getByText("El gráfico aparecerá con la primera aportación acreditada.")).toBeInTheDocument();
  });
});

describe("ShareRing", () => {
  it("is labelled with the viewer's share", () => {
    render(<ShareRing bps={1234} />);
    expect(screen.getByRole("img", { name: "Tu parte de la DAO: 12,34 %" })).toBeInTheDocument();
  });
});
