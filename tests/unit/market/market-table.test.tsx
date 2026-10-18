import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketTable } from "@/components/market/market-table";
import type { MarketCoin } from "@/lib/market/types";

const btc: MarketCoin = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
  rank: 1,
  priceUsd: 64321.456,
  change1h: 0.1,
  change24h: 2.345,
  change7d: -3.2,
  marketCapUsd: 1.23e12,
  volumeUsd: 3e10,
  sparkline7d: [1, 2, 3],
};
const broken: MarketCoin = { ...btc, id: "weird", name: "Weird", symbol: "wrd", image: null, rank: 2, priceUsd: null, change24h: null, sparkline7d: [] };

describe("MarketTable", () => {
  it("has the caption and the nine columns", () => {
    render(<MarketTable coins={[btc]} />);
    expect(screen.getByRole("table", { name: "Las 100 criptos con mayor capitalización" })).toBeInTheDocument();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["#", "Cripto", "Precio", "1 h", "24 h", "7 d", "Capitalización", "Volumen 24 h", "7 días"]);
  });
  it("links each name to its page", () => {
    render(<MarketTable coins={[btc]} />);
    expect(screen.getByRole("link", { name: /Bitcoin/ })).toHaveAttribute("href", "/mercado/bitcoin");
  });
  it("shows signed variations with an aria-hidden arrow and token colours", () => {
    render(<MarketTable coins={[btc]} />);
    const up = screen.getByText("+2,35 %");
    expect(up.closest("td")).toHaveClass("text-success");
    expect(up.closest("td")!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const down = screen.getByText("-3,20 %");
    expect(down.closest("td")).toHaveClass("text-danger");
    expect(down.closest("td")!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("hides the secondary columns below md", () => {
    render(<MarketTable coins={[btc]} />);
    for (const name of ["1 h", "7 d", "Capitalización", "Volumen 24 h", "7 días"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("hidden", "md:table-cell");
    }
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    for (const i of [3, 5, 6, 7, 8]) expect(cells[i]).toHaveClass("hidden", "md:table-cell");
    for (const i of [0, 1, 2, 4]) expect(cells[i]).not.toHaveClass("hidden");
  });
  it("renders a row with missing figures as dashes and no image", () => {
    const { container } = render(<MarketTable coins={[broken]} />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("[role=img]")).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|undefined|null/);
  });
  it("renders the image only when present, 20x20, lazy, decorative", () => {
    render(<MarketTable coins={[btc]} />);
    const img = screen.getAllByRole("row")[1]!.querySelector("img")!;
    expect(img).toHaveAttribute("src", btc.image!);
    expect(img).toHaveAttribute("width", "20");
    expect(img).toHaveAttribute("height", "20");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });
});
