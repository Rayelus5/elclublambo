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
  chainId: 59141,
  txHash: HASH,
  createdAt: "2026-10-18T10:00:00Z",
  ...over,
});

describe("TipsReceived", () => {
  it("shows the server totals of the active chain as a labelled list", () => {
    render(
      <TipsReceived
        activeChainId={59141}
        totals={[
          { token: "USDC", total: 7_500_000n, count: 2 },
          { token: "ETH", total: 1_000_000_000_000_000n, count: 1 },
        ]}
        entries={[entry({ tipId: "4", amount: 700_000_000n, chainId: 59144 })]}
      />,
    );
    expect(screen.getByText("Totales en Linea Sepolia")).toBeInTheDocument();
    const totals = document.querySelector("dl")!;
    expect(totals).toHaveAttribute("aria-labelledby", "tips-totals-title");
    expect(totals.textContent).toContain("7,5 USDC");
    expect(totals.textContent).toContain("0,001 ETH");
    // the listed tip of another chain is not added to the totals
    expect(totals.textContent).not.toContain("700");
  });

  it("lists the tips with anonymity rules and explorer links", () => {
    render(
      <TipsReceived
        activeChainId={59141}
        totals={[{ token: "USDC", total: 15_000_000n, count: 3 }]}
        entries={[entry({ tipId: "1" }), entry({ tipId: "2", donorName: null, anonymous: true }), entry({ tipId: "3", isMe: true, anonymous: true, donorName: "Yo" })]}
      />,
    );
    const list = screen.getAllByRole("list").at(-1)!;
    expect(within(list).getByText("Dona")).toBeInTheDocument();
    expect(within(list).getByText("Anónimo")).toBeInTheDocument();
    expect(within(list).getByText("Tú (anónimo)")).toBeInTheDocument();
    expect(within(list).getAllByRole("link", { name: /ver transacción/i })[0]).toHaveAttribute("href", `https://sepolia.lineascan.build/tx/${HASH}`);
  });

  it("says there are none on the active chain when only other chains have tips", () => {
    render(<TipsReceived activeChainId={59141} totals={[]} entries={[entry({ chainId: 59144 })]} />);
    expect(screen.getByText("Sin propinas en Linea Sepolia.")).toBeInTheDocument();
  });

  it("says there are none yet", () => {
    render(<TipsReceived activeChainId={59141} totals={[]} entries={[]} />);
    expect(screen.getByText(/todavía no hay propinas/i)).toBeInTheDocument();
  });
});
