import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoinFacts } from "@/components/market/coin-facts";
import type { CoinDetail } from "@/lib/market/types";

const coin: CoinDetail = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: null,
  rank: 1,
  priceUsd: 65000,
  change24h: -1.5,
  marketCapUsd: 1_280_000_000_000,
  volumeUsd: 30_000_000_000,
  circulatingSupply: 19_700_000,
  maxSupply: 21_000_000,
  athUsd: 73_000,
  athDate: "2024-03-14T07:10:36.635Z",
  homepage: "https://bitcoin.org",
};

function value(term: string): string {
  const dt = screen.getByText(term, { selector: "dt" });
  return dt.nextElementSibling!.textContent!;
}

describe("CoinFacts", () => {
  it("lists the key data in a description list", () => {
    const { container } = render(<CoinFacts coin={coin} />);
    expect(container.querySelector("dl")).not.toBeNull();
    expect(value("Precio")).toContain("65.000,00 USD");
    expect(value("Variación 24 h")).toContain("-1,50 %");
    expect(value("Capitalización")).toContain("USD");
    expect(value("Volumen 24 h")).toContain("USD");
    expect(value("Puesto")).toBe("#1");
    expect(value("Suministro circulante")).toContain("19");
    expect(value("Suministro máximo")).toContain("21");
    expect(value("Máximo histórico")).toContain("73.000,00 USD");
    expect(value("Máximo histórico")).toContain("2024");
  });

  it("says Sin límite when there is no max supply", () => {
    render(<CoinFacts coin={{ ...coin, maxSupply: null }} />);
    expect(value("Suministro máximo")).toBe("Sin límite");
  });

  it("links the homepage externally only when present", () => {
    const { rerender } = render(<CoinFacts coin={coin} />);
    const a = screen.getByRole("link", { name: /bitcoin\.org/ });
    expect(a).toHaveAttribute("href", "https://bitcoin.org");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    rerender(<CoinFacts coin={{ ...coin, homepage: null }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows dashes for missing figures", () => {
    render(<CoinFacts coin={{ ...coin, priceUsd: null, athUsd: null, athDate: null, rank: null, circulatingSupply: null }} />);
    expect(value("Precio")).toBe("—");
    expect(value("Puesto")).toBe("—");
    expect(value("Máximo histórico")).toBe("—");
  });

  // T-003: the key data are small cards in a grid that reflows by the panel's width (two per row on a phone).
  it("lays the facts out as cards in a responsive grid", () => {
    const { container } = render(<CoinFacts coin={coin} />);
    const dl = container.querySelector("dl")!;
    expect(dl).toHaveClass("grid", "grid-cols-2");
    expect(dl.parentElement).toHaveClass("@container");
    for (const card of dl.children) expect(card).toHaveClass("rounded-panel", "border", "bg-surface");
  });

  it("states the 24 h direction with an icon, not colour alone", () => {
    render(<CoinFacts coin={coin} />);
    const dd = screen.getByText("Variación 24 h", { selector: "dt" }).nextElementSibling!;
    expect(dd).toHaveClass("text-danger");
    expect(dd.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
