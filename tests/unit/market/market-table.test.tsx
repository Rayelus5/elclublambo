import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketTable } from "@/components/market/market-table";
import type { MarketCoin } from "@/lib/market/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
    // Neutral: the table shows 10 at first, so the caption does not claim a count (the live counter does).
    expect(screen.getByRole("table", { name: "Criptos con mayor capitalización" })).toBeInTheDocument();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["#", "Cripto", "Precio", "1 h", "24 h", "7 d", "Capitalización", "Volumen 24 h", "7 días"]);
  });
  it("truncates a long symbol (untrusted length) instead of letting it widen the Cripto cell", () => {
    const sym = "averyveryverylongsymbol";
    render(<MarketTable coins={[{ ...btc, symbol: sym }]} />);
    const span = screen.getByText(sym);
    expect(span).toHaveClass("truncate", "min-w-0", "max-w-[6ch]");
    expect(span).not.toHaveClass("shrink-0");
    expect(span).toHaveAttribute("title", sym.toUpperCase());
  });
  it("links each name to its page", () => {
    render(<MarketTable coins={[btc]} />);
    expect(screen.getByRole("link", { name: /Bitcoin/ })).toHaveAttribute("href", "/mercado/bitcoin");
  });
  it("shows signed variations with an aria-hidden arrow and token colours", () => {
    render(<MarketTable coins={[btc]} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    const up = within(cells[4]!).getByText("+2,35 %");
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
  // T-003: below 26rem the panel shows compact exchange-style rows (logo, name over symbol, price over the 24 h
  // change), so # and the 24 h column join the tiers too.
  const TIERS = ["@min-[26rem]", "@min-[38rem]", "@3xl", "@5xl"] as const;
  const SHOW_FROM: Record<string, { index: number; tier: (typeof TIERS)[number] }> = {
    "#": { index: 0, tier: "@min-[26rem]" },
    "24 h": { index: 4, tier: "@min-[26rem]" },
    "7 d": { index: 5, tier: "@min-[38rem]" },
    Capitalización: { index: 6, tier: "@min-[38rem]" },
    "7 días": { index: 8, tier: "@3xl" },
    "1 h": { index: 3, tier: "@5xl" },
    "Volumen 24 h": { index: 7, tier: "@5xl" },
  };
  it("shows Cripto and Precio always and the rest by panel-width tier", () => {
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
    for (const name of ["Cripto", "Precio"]) expect(screen.getByRole("columnheader", { name })).not.toHaveClass("hidden");
    for (const i of [1, 2]) expect(cells[i]).not.toHaveClass("hidden");
  });
  it("compact rows: the price cell carries the 24 h change and the name cell the rank, only below the first tier", () => {
    render(<MarketTable coins={[btc]} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    const compactChange = within(cells[2]!).getByText("+2,35 %").closest("[data-compact-change]")!;
    expect(compactChange).toHaveClass("@min-[26rem]:hidden", "text-success");
    expect(compactChange.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(compactChange as HTMLElement).getByText("Cambio 24 h:")).toHaveClass("sr-only");
    const rank = within(cells[1]!).getByText("#1");
    expect(rank).toHaveClass("@min-[26rem]:hidden");
    // Exchange-style: name over symbol.
    expect(within(cells[1]!).getByText("Bitcoin").parentElement).toHaveClass("flex-col");
  });
  // The whole row is the touch target through a click handler on the row (market-row.test.tsx has the rules); the
  // only link stays in the name cell, so the table keeps its row/cell semantics and each row is one tab stop. No
  // stretched ::after overlay: where a <tr> is not a containing block it would cover the whole panel.
  it("makes the whole row tappable with one real link in the name cell and no overlay", () => {
    render(<MarketTable coins={[btc]} />);
    const row = screen.getAllByRole("row")[1]!;
    expect(row).toHaveClass("cursor-pointer");
    expect(row).not.toHaveClass("relative");
    const links = within(row).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.className).not.toMatch(/after:/);
    expect(links[0]!.closest("td")).toBe(within(row).getAllByRole("cell")[1]);
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
  it("renders the image only when present, 28x28, lazy, decorative", () => {
    render(<MarketTable coins={[btc]} />);
    const img = screen.getAllByRole("row")[1]!.querySelector("img")!;
    expect(img).toHaveAttribute("src", btc.image!);
    expect(img).toHaveAttribute("width", "28");
    expect(img).toHaveAttribute("height", "28");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  // T-005: ten at a time over the data already on the page.
  describe("Ver más", () => {
    const many = (n: number): MarketCoin[] =>
      Array.from({ length: n }, (_, k) => ({ ...btc, id: `coin-${k + 1}`, name: `Coin ${k + 1}`, rank: k + 1 }));
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    const counter = () => screen.getByText(/^Mostrando \d+ de \d+$/);

    it("shows the first ten and a live counter", () => {
      render(<MarketTable coins={many(25)} />);
      expect(bodyRows()).toHaveLength(10);
      expect(counter()).toHaveTextContent("Mostrando 10 de 25");
      expect(counter()).toHaveAttribute("aria-live", "polite");
      expect(screen.getByRole("button", { name: "Ver más" })).toBeInTheDocument();
    });

    it("reveals ten more per click, moves focus to the first new row and hides the button at the end", () => {
      render(<MarketTable coins={many(25)} />);
      const more = screen.getByRole("button", { name: "Ver más" });
      expect(more.className).toContain("min-h-11");
      fireEvent.click(more);
      expect(bodyRows()).toHaveLength(20);
      expect(counter()).toHaveTextContent("Mostrando 20 de 25");
      expect(document.activeElement).toBe(within(bodyRows()[10]!).getByRole("link", { name: /Coin 11/ }));
      fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
      expect(bodyRows()).toHaveLength(25);
      expect(counter()).toHaveTextContent("Mostrando 25 de 25");
      expect(document.activeElement).toBe(within(bodyRows()[20]!).getByRole("link", { name: /Coin 21/ }));
      expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
    });

    it("never counts past the total when a revalidated list shrinks", () => {
      const { rerender } = render(<MarketTable coins={many(25)} />);
      fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
      rerender(<MarketTable coins={many(7)} />);
      expect(bodyRows()).toHaveLength(7);
      expect(counter()).toHaveTextContent("Mostrando 7 de 7");
      expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
    });

    it("has no button when everything fits in the first page", () => {
      render(<MarketTable coins={many(7)} />);
      expect(bodyRows()).toHaveLength(7);
      expect(counter()).toHaveTextContent("Mostrando 7 de 7");
      expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
    });
  });
});
