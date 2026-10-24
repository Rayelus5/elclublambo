import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExpenseList } from "@/components/donations/expense-list";
import { explorerTx } from "@/lib/economy/networks";

const HASH_A = `0x${"a1".repeat(32)}`;
const HASH_B = `0x${"b2".repeat(32)}`;
const items = [
  { id: "e1", chainId: 84532, token: "USDC" as const, amount: 12_500_000n, txHash: HASH_A, note: "Servidor del mes", recordedAt: new Date().toISOString(), recorderLabel: "@ana" },
  { id: "e2", chainId: 421614, token: "ETH" as const, amount: 10n ** 16n, txHash: HASH_B, note: "Gas de la Safe", recordedAt: new Date().toISOString(), recorderLabel: "@leo" },
];

describe("ExpenseList", () => {
  it("links every expense to its transaction in the network's explorer", () => {
    render(<ExpenseList items={items} />);
    const list = screen.getByRole("list", { name: "Gastos de la Safe" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([explorerTx(84532, HASH_A), explorerTx(421614, HASH_B)]);
    for (const l of links) expect(l).toHaveAttribute("target", "_blank");
  });
  it("shows amount, note and who noted it", () => {
    render(<ExpenseList items={items} />);
    expect(screen.getByText("12,5 USDC")).toBeInTheDocument();
    expect(screen.getByText("Servidor del mes")).toBeInTheDocument();
    expect(screen.getByText(/@ana/)).toBeInTheDocument();
  });
  it("says so when there are none", () => {
    render(<ExpenseList items={[]} />);
    expect(screen.getByText(/Aún no hay gastos/)).toBeInTheDocument();
  });
});
