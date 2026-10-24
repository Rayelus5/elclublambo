import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/giveaways/actions", () => ({ markPrizePaidAction: vi.fn(), markPrizeDeliveredAction: vi.fn() }));

import { PrizeList } from "@/components/giveaways/prize-list";
import { isWin } from "@/lib/giveaways/format";
import type { GiveawayPrizeState } from "@/lib/giveaways/types";

function prize(over: Partial<GiveawayPrizeState>): GiveawayPrizeState {
  return {
    id: "p1",
    rank: 1,
    kind: "role",
    label: "Veterano",
    chainId: null,
    amount: null,
    token: null,
    status: "delivered",
    unawardedReason: null,
    winnerPosition: 2,
    winnerLabel: "@ana",
    iWon: true,
    winnerAddress: null,
    payoutTxHash: null,
    paidAt: null,
    deliveredAt: "2026-10-24T12:00:00Z",
    ...over,
  };
}

describe("isWin", () => {
  it("only awarded, paid or delivered prizes are wins", () => {
    for (const status of ["awarded", "paid", "delivered"] as const) expect(isWin({ iWon: true, status })).toBe(true);
    expect(isWin({ iWon: true, status: "unawarded" })).toBe(false);
    expect(isWin({ iWon: true, status: "pending" })).toBe(false);
    expect(isWin({ iWon: false, status: "paid" })).toBe(false);
  });
});

describe("PrizeList", () => {
  it("marks my won prize with «Tú» and its position", () => {
    render(<PrizeList prizes={[prize({})]} treasurer={false} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Tú")).toBeInTheDocument();
    expect(row).toHaveTextContent("posición 2");
    expect(row).toHaveTextContent("Rol asignado");
  });

  it("a role prize left role_unavailable is not my win: no «Tú», no name, but the drawn position stays", () => {
    render(<PrizeList prizes={[prize({ status: "unawarded", unawardedReason: "role_unavailable", deliveredAt: null })]} treasurer={false} />);
    const row = screen.getByRole("listitem");
    expect(within(row).queryByText("Tú")).toBeNull();
    expect(within(row).queryByText("@ana")).toBeNull();
    expect(row).toHaveTextContent("Sin ganador");
    expect(row).toHaveTextContent("Posición sorteada: 2");
  });

  it("treasurers get «Marcar entregado» on an awarded custom prize and «Marcar pagado» on an awarded USDC one", () => {
    render(
      <PrizeList
        treasurer
        prizes={[
          prize({ id: "a", kind: "crypto", label: "5 USDC", chainId: 84532, amount: 5_000_000n, token: "USDC", status: "awarded", iWon: false, deliveredAt: null }),
          prize({ id: "b", rank: 2, kind: "custom", label: "Camiseta", status: "awarded", iWon: false, deliveredAt: null }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Marcar pagado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar entregado" })).toBeInTheDocument();
  });
});
