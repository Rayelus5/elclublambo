import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TipsReceived } from "@/components/profile/tips-received";
import type { TipEntry } from "@/lib/payments/queries";

const HASH = `0x${"12".repeat(32)}`;
const entry = (over: Partial<TipEntry> = {}): TipEntry => ({
  tipId: "t",
  donorName: "Dona",
  isMe: false,
  anonymous: false,
  token: "USDC",
  amount: 5_000_000n,
  chainId: 84532,
  txHash: HASH,
  createdAt: "2026-10-18T10:00:00Z",
  ...over,
});

describe("TipsReceived deleted message (M3)", () => {
  it("marks a tip whose message was deleted, still counting the money", () => {
    render(<TipsReceived totals={[]} entries={[entry({ tipId: "d", messageDeleted: true }), entry({ tipId: "l" })]} />);
    expect(screen.getAllByText("Mensaje eliminado")).toHaveLength(1);
  });
});

describe("TipsReceived hidden hash", () => {
  it("shows no explorer link for an anonymous tip with a hidden hash", () => {
    render(<TipsReceived totals={[]} entries={[entry({ donorName: null, anonymous: true, txHash: null })]} />);
    expect(screen.queryByRole("link", { name: /explorador/i })).toBeNull();
    expect(screen.getByText("Anónimo")).toBeInTheDocument();
  });
});

describe("TipsReceived", () => {
  it("shows the server totals per token (every enabled network) as a labelled list", () => {
    render(
      <TipsReceived
        totals={[
          { token: "USDC", total: 7_500_000n, count: 2 },
          { token: "ETH", total: 1_000_000_000_000_000n, count: 1 },
        ]}
        entries={[entry({ tipId: "4", amount: 700_000_000n, chainId: 8453 })]}
      />,
    );
    expect(screen.getByText("Totales")).toBeInTheDocument();
    expect(screen.queryByText(/Totales en/)).not.toBeInTheDocument();
    const totals = document.querySelector("dl")!;
    expect(totals).toHaveAttribute("aria-labelledby", "tips-totals-title");
    expect(totals.textContent).toContain("7,5 USDC");
    expect(totals.textContent).toContain("0,001 ETH");
    // the totals come from the server, never from the listed tips
    expect(totals.textContent).not.toContain("700");
  });

  it("tips on 84532 and 421614: one total per token and each row carries its own network logo", () => {
    render(
      <TipsReceived
        totals={[{ token: "USDC", total: 8_000_000n, count: 2 }]}
        entries={[entry({ tipId: "b", chainId: 84532, amount: 5_000_000n }), entry({ tipId: "a", chainId: 421614, amount: 3_000_000n })]}
      />,
    );
    const totals = document.querySelector("dl")!;
    expect(within(totals).getAllByRole("definition")).toHaveLength(1);
    expect(totals.textContent).toContain("8 USDC");
    const list = screen.getAllByRole("list").at(-1)!;
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByAltText("Base Sepolia")).toBeInTheDocument();
    expect(within(rows[1]!).getByAltText("Arbitrum Sepolia")).toBeInTheDocument();
  });

  it("lists the tips with anonymity rules and explorer links", () => {
    render(
      <TipsReceived
       
        totals={[{ token: "USDC", total: 15_000_000n, count: 3 }]}
        entries={[entry({ tipId: "1" }), entry({ tipId: "2", donorName: null, anonymous: true }), entry({ tipId: "3", isMe: true, anonymous: true, donorName: "Yo" })]}
      />,
    );
    const list = screen.getAllByRole("list").at(-1)!;
    expect(within(list).getByText("Dona")).toBeInTheDocument();
    expect(within(list).getByText("Anónimo")).toBeInTheDocument();
    expect(within(list).getByText("Tú (anónimo)")).toBeInTheDocument();
    expect(within(list).getAllByRole("link", { name: /ver transacción/i })[0]).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`);
  });

  it("says there are none on the active networks when only other networks have tips", () => {
    render(<TipsReceived totals={[]} entries={[entry({ chainId: 8453 })]} />);
    expect(screen.getByText("Sin propinas en las redes activas.")).toBeInTheDocument();
  });

  it("says there are none yet", () => {
    render(<TipsReceived totals={[]} entries={[]} />);
    expect(screen.getByText(/todavía no hay propinas/i)).toBeInTheDocument();
  });
});
