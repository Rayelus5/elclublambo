import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrizeStatus } from "@/components/giveaways/prize-status";
import { explorerTx } from "@/lib/economy/networks";
import type { GiveawayPrizeState } from "@/lib/giveaways/types";

const HASH = `0x${"c3".repeat(32)}`;

function prize(over: Partial<GiveawayPrizeState>): GiveawayPrizeState {
  return {
    id: "p1",
    rank: 1,
    kind: "crypto",
    label: "5 USDC",
    chainId: 84532,
    amount: 5_000_000n,
    token: "USDC",
    status: "awarded",
    unawardedReason: null,
    winnerPosition: 2,
    winnerLabel: "@ana",
    iWon: false,
    winnerAddress: null,
    payoutTxHash: null,
    paidAt: null,
    deliveredAt: null,
    ...over,
  };
}

describe("PrizeStatus", () => {
  it("awarded USDC: «Pendiente de pago»", () => {
    render(<PrizeStatus prize={prize({})} />);
    expect(screen.getByText("Pendiente de pago")).toBeInTheDocument();
  });

  it("paid: «Pagado» with a link to the explorer", () => {
    render(<PrizeStatus prize={prize({ status: "paid", payoutTxHash: HASH, paidAt: "2026-10-24T12:00:00Z" })} />);
    expect(screen.getByText("Pagado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver transacción/ })).toHaveAttribute("href", explorerTx(84532, HASH));
  });

  it("a role handed out at the draw: «Rol asignado»", () => {
    render(<PrizeStatus prize={prize({ kind: "role", chainId: null, amount: null, token: null, status: "delivered", deliveredAt: "x" })} />);
    expect(screen.getByText("Rol asignado")).toBeInTheDocument();
  });

  it("a custom prize: «Pendiente de entrega», then «Entregado»", () => {
    const { unmount } = render(<PrizeStatus prize={prize({ kind: "custom", chainId: null, amount: null, token: null })} />);
    expect(screen.getByText("Pendiente de entrega")).toBeInTheDocument();
    unmount();
    render(<PrizeStatus prize={prize({ kind: "custom", chainId: null, amount: null, token: null, status: "delivered", deliveredAt: "x" })} />);
    expect(screen.getByText("Entregado")).toBeInTheDocument();
  });

  it("unawarded: «Sin ganador» with the reason", () => {
    const { unmount } = render(<PrizeStatus prize={prize({ status: "unawarded", unawardedReason: "not_enough_entries", winnerPosition: null })} />);
    expect(screen.getByText("Sin ganador")).toBeInTheDocument();
    expect(screen.getByText("No hubo participantes suficientes.")).toBeInTheDocument();
    unmount();
    render(<PrizeStatus prize={prize({ kind: "role", status: "unawarded", unawardedReason: "role_unavailable" })} />);
    expect(screen.getByText("El rol ya no se podía sortear.")).toBeInTheDocument();
  });

  it("before the draw: «Por sortear»", () => {
    render(<PrizeStatus prize={prize({ status: "pending", winnerPosition: null, winnerLabel: null })} />);
    expect(screen.getByText("Por sortear")).toBeInTheDocument();
  });
});
