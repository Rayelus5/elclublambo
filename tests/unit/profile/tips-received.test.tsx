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
  it("totals per token for the active chain only", () => {
    render(
      <TipsReceived
        activeChainId={59141}
        entries={[
          entry({ tipId: "1", amount: 5_000_000n }),
          entry({ tipId: "2", amount: 2_500_000n }),
          entry({ tipId: "3", token: "ETH", amount: 1_000_000_000_000_000n }),
          entry({ tipId: "4", amount: 700_000_000n, chainId: 59144 }),
        ]}
      />,
    );
    const totals = screen.getByLabelText(/totales/i);
    expect(totals.textContent).toContain("7,5 USDC");
    expect(totals.textContent).toContain("0,001 ETH");
    expect(totals.textContent).not.toContain("707");
    expect(totals.textContent).not.toContain("700");
  });

  it("lists the tips with anonymity rules and explorer links", () => {
    render(
      <TipsReceived
        activeChainId={59141}
        entries={[entry({ tipId: "1" }), entry({ tipId: "2", donorName: null, anonymous: true }), entry({ tipId: "3", isMe: true, anonymous: true, donorName: "Yo" })]}
      />,
    );
    const list = screen.getByRole("list");
    expect(within(list).getByText("Dona")).toBeInTheDocument();
    expect(within(list).getByText("Anónimo")).toBeInTheDocument();
    expect(within(list).getByText("Tú (anónimo)")).toBeInTheDocument();
    expect(within(list).getAllByRole("link", { name: /ver transacción/i })[0]).toHaveAttribute("href", `https://sepolia.lineascan.build/tx/${HASH}`);
  });

  it("says there are none yet", () => {
    render(<TipsReceived activeChainId={59141} entries={[]} />);
    expect(screen.getByText(/todavía no hay propinas/i)).toBeInTheDocument();
  });
});
