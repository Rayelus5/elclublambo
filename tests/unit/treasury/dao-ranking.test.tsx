import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DaoHistory } from "@/components/treasury/dao-history";
import { DaoRanking } from "@/components/treasury/dao-ranking";

const ME = "11111111-1111-4111-8111-111111111111";
const HASH = `0x${"cd".repeat(32)}`;

describe("DaoRanking", () => {
  const entries = [
    { rank: 1, memberId: null, label: "Anónimo", shareBps: 6000, netUsdc: 60_000_000n, club: false },
    { rank: 2, memberId: ME, label: "Ana", shareBps: 25, netUsdc: 2_500_000n, club: false },
  ];
  it("shows rank, name or Anónimo, percentage and contributed amount", () => {
    render(<DaoRanking entries={entries} viewerId={ME} />);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("Anónimo")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("60 %")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("60 USDC")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("0,25 %")).toBeInTheDocument();
  });
  it("highlights the viewer's own row", () => {
    render(<DaoRanking entries={entries} viewerId={ME} />);
    const rows = screen.getAllByRole("row");
    expect(rows[2]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });
  it("shows the club fund by name, with no contributed amount", () => {
    render(<DaoRanking entries={[{ rank: 1, memberId: null, label: "Fondo del club", shareBps: 5000, netUsdc: 0n, club: true }]} viewerId={ME} />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("Fondo del club")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
  it("says so when nobody has donated", () => {
    render(<DaoRanking entries={[]} viewerId={ME} />);
    expect(screen.getByText("Aún no hay aportaciones.")).toBeInTheDocument();
  });
});

describe("DaoHistory", () => {
  it("links the explorer only when the hash is visible to the viewer", () => {
    render(
      <DaoHistory
        chainId={59141}
        entries={[
          { ledgerId: "a", memberId: null, label: "Anónimo", amount: 3_000_000n, txHash: null, creditedAt: "2026-10-18T10:00:00Z" },
          { ledgerId: "b", memberId: ME, label: "Ana", amount: 1_000_000n, txHash: HASH, creditedAt: "2026-10-17T10:00:00Z" },
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Ver en el explorador/ })).toHaveLength(1);
    expect(screen.getByText("3 USDC")).toBeInTheDocument();
  });
});
