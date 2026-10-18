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
  // Ruling F4b-R4: columns appear in tiers so the table always fits its panel (no inner sideways scroll). The tiers
  // follow the panel's own width (container queries), not the viewport: the forum shell's sidebar and right rail make
  // <main> narrower at 1024 px (about 440 px) than at 768 px (about 504 px).
  //   base: #, Cripto, Precio, 24 h · "md" tier (@min-[38rem]): 7 d, Capitalización · "lg" tier (@3xl, 48rem): 7-day
  //   sparkline · "xl" tier (@5xl, 64rem): 1 h, Volumen 24 h.
  const TIERS = ["@min-[38rem]", "@3xl", "@5xl"] as const;
  const SHOW_FROM: Record<string, { index: number; tier: (typeof TIERS)[number] }> = {
    "7 d": { index: 5, tier: "@min-[38rem]" },
    Capitalización: { index: 6, tier: "@min-[38rem]" },
    "7 días": { index: 8, tier: "@3xl" },
    "1 h": { index: 3, tier: "@5xl" },
    "Volumen 24 h": { index: 7, tier: "@5xl" },
  };
  it("shows #, Cripto, Precio and 24 h always and the rest by panel-width tier", () => {
    render(<MarketTable coins={[btc]} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    for (const [name, { index, tier }] of Object.entries(SHOW_FROM)) {
      const header = screen.getByRole("columnheader", { name });
      for (const el of [header, cells[index]!]) {
        expect(el).toHaveClass("hidden", `${tier}:table-cell`);
        for (const other of TIERS.filter((t) => t !== tier)) expect(el).not.toHaveClass(`${other}:table-cell`);
        expect(el.className).not.toMatch(/(^|\s)(md|lg|xl):table-cell/);
      }
    }
    for (const name of ["#", "Cripto", "Precio", "24 h"]) expect(screen.getByRole("columnheader", { name })).not.toHaveClass("hidden");
    for (const i of [0, 1, 2, 4]) expect(cells[i]).not.toHaveClass("hidden");
  });
  it("is a size container that never scrolls sideways", () => {
    const { container } = render(<MarketTable coins={[btc]} />);
    const panel = container.firstElementChild!;
    expect(panel).toHaveClass("@container");
    expect(panel.className).not.toMatch(/overflow-x-(auto|scroll)/);
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
