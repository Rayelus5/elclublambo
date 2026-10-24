import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DonationSummary, RecentDonations } from "@/components/donations/donation-summary";
import { SafeBalances } from "@/components/donations/safe-balances";

const overview = {
  totalUsd6: 2_005_000_000n,
  donorCount: 3,
  byChain: [
    { chainId: 84532, usd6: 5_000_000n },
    { chainId: 421614, usd6: 2_000_000_000n },
  ],
  recent: [
    { id: "d1", at: new Date().toISOString(), chainId: 421614, token: "ETH" as const, amount: 10n ** 18n, usd6: 2_000_000_000n, donorLabel: "@ana" },
    { id: "d2", at: new Date().toISOString(), chainId: 84532, token: "USDC" as const, amount: 5_000_000n, usd6: 5_000_000n, donorLabel: null },
  ],
};

describe("DonationSummary", () => {
  it("shows the total in USD, the donors and the split by network", () => {
    render(<DonationSummary overview={overview} />);
    expect(screen.getByText("2.005 USD")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    const split = screen.getByRole("list", { name: "Por red" });
    expect(within(split).getByText("Base Sepolia")).toBeInTheDocument();
    expect(within(split).getByText("5 USD")).toBeInTheDocument();
    expect(within(split).getByText("2.000 USD")).toBeInTheDocument();
  });
});

describe("RecentDonations", () => {
  it("lists amount, token and network; a hidden donor reads «Anónimo»", () => {
    render(<RecentDonations items={overview.recent} />);
    const items = within(screen.getByRole("list", { name: "Donaciones recientes" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("@ana");
    expect(items[0]).toHaveTextContent("1 ETH");
    expect(items[0]).toHaveTextContent("Arbitrum Sepolia");
    expect(items[1]).toHaveTextContent("Anónimo");
    expect(items[1]).toHaveTextContent("5 USDC");
  });
  it("empty: invites to be the first", () => {
    render(<RecentDonations items={[]} />);
    expect(screen.getByText("Aún no hay donaciones. La primera puede ser la tuya.")).toBeInTheDocument();
  });
});

describe("SafeBalances", () => {
  it("one row per network with USDC and ETH; an unreadable balance says so", () => {
    render(
      <SafeBalances
        safe="0x380f2e12081995359e2Ab88E3c31c6b227904234"
        balances={[
          { chainId: 84532, usdc: 12_500_000n, eth: null },
          { chainId: 421614, usdc: 0n, eth: 10n ** 17n },
        ]}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Saldos de la Safe" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Base Sepolia");
    expect(items[0]).toHaveTextContent("12,5 USDC");
    expect(items[0]).toHaveTextContent("No disponible");
    expect(items[1]).toHaveTextContent("0,1 ETH");
    expect(within(items[1]!).getByRole("link", { name: /Ver la Safe en el explorador de Arbitrum Sepolia/ })).toHaveAttribute(
      "href",
      expect.stringContaining("0x380f2e12081995359e2Ab88E3c31c6b227904234"),
    );
  });
});
