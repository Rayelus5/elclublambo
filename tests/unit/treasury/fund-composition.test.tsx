import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FundComposition } from "@/components/treasury/fund-composition";
import type { Composition } from "@/lib/treasury/queries";

const comp: Composition = {
  usdcUnits: 5_000_000n,
  ethWei: 10n ** 18n,
  wethWei: 0n,
  ethPriceE8: 250_000_000_000n,
  priceSource: "chainlink",
  takenAt: "2026-10-18T10:00:00Z",
};

describe("FundComposition", () => {
  it("lists each asset with its amount and its USD value, and the ETH price with its source", () => {
    render(<FundComposition composition={comp} />);
    const rows = screen.getAllByRole("listitem");
    const usdc = rows.find((r) => r.textContent?.includes("USDC"))!;
    expect(within(usdc).getByText("5 USDC")).toBeInTheDocument();
    expect(within(usdc).getByText("5 USD")).toBeInTheDocument();
    const eth = rows.find((r) => within(r).queryByText("1 ETH"))!;
    expect(within(eth).getByText("2.500 USD")).toBeInTheDocument();
    expect(screen.getByText("Precio ETH: 2.500 USD · Chainlink")).toBeInTheDocument();
    expect(screen.getByText(/18 oct 2026/)).toBeInTheDocument();
  });

  it("names CoinGecko when the price came from the fallback", () => {
    render(<FundComposition composition={{ ...comp, priceSource: "coingecko" }} />);
    expect(screen.getByText("Precio ETH: 2.500 USD · CoinGecko")).toBeInTheDocument();
  });

  it("values WETH at the ETH price, without floats", () => {
    render(<FundComposition composition={{ ...comp, wethWei: 3n * 10n ** 17n, ethPriceE8: 123_456_789_012n }} />);
    // 0,3 · 1234,56789012 = 370,370367036 -> 370,37 USD (truncated)
    expect(screen.getByText("0,3 WETH")).toBeInTheDocument();
    expect(screen.getByText("370,37 USD")).toBeInTheDocument();
  });

  it("says so when the fund has not been valued yet", () => {
    render(<FundComposition composition={null} />);
    expect(screen.getByText("El fondo aún no tiene valoración.")).toBeInTheDocument();
  });
});
