import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const enterGiveawayAction = vi.hoisted(() => vi.fn());
const leaveGiveawayAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giveaways/actions", () => ({ enterGiveawayAction, leaveGiveawayAction }));

import { GiveawayCard } from "@/components/giveaways/giveaway-card";
import type { GiveawayCard as Card } from "@/lib/giveaways/types";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-24T12:00:00Z");

function card(over: Partial<Card> = {}): Card {
  return {
    id: ID,
    title: "Sorteo de otoño",
    closesAt: new Date(NOW + (2 * 3600 + 5 * 60) * 1000).toISOString(),
    status: "open",
    entryCount: 3,
    iEntered: false,
    prizes: [
      { rank: 1, kind: "crypto", label: "25 USDC", chainId: 84532, amount: 25_000_000n },
      { rank: 2, kind: "role", label: "Veterano", chainId: null, amount: null },
      { rank: 3, kind: "custom", label: "Camiseta", chainId: null, amount: null },
    ],
    winners: [],
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  enterGiveawayAction.mockReset().mockResolvedValue({ ok: true });
  leaveGiveawayAction.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe("GiveawayCard", () => {
  it("shows the countdown, the prizes and «Participar» while open", () => {
    render(<GiveawayCard giveaway={card()} />);
    expect(screen.getByText("Cierra en 2 h 5 min")).toBeInTheDocument();
    expect(screen.getByText("25 USDC")).toBeInTheDocument();
    expect(screen.getByText("Veterano")).toBeInTheDocument();
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
    expect(screen.getByText("3 participantes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Participar" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Sorteo de otoño" })).toHaveAttribute("href", `/sorteos/${ID}`);
  });

  it("offers «Salir» once inside, and calls the leave action", async () => {
    vi.useRealTimers();
    const later = card({ iEntered: true, closesAt: new Date(Date.now() + 3600_000).toISOString() });
    render(<GiveawayCard giveaway={later} />);
    await userEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(leaveGiveawayAction).toHaveBeenCalledWith(ID);
    expect(enterGiveawayAction).not.toHaveBeenCalled();
  });

  it("calls the enter action from «Participar»", async () => {
    vi.useRealTimers();
    render(<GiveawayCard giveaway={card({ closesAt: new Date(Date.now() + 3600_000).toISOString() })} />);
    await userEvent.click(screen.getByRole("button", { name: "Participar" }));
    expect(enterGiveawayAction).toHaveBeenCalledWith(ID);
  });

  it("counts seconds in the last hour", () => {
    render(<GiveawayCard giveaway={card({ closesAt: new Date(NOW + 9 * 60_000 + 5_000).toISOString() })} />);
    expect(screen.getByText("Cierra en 9 min 5 s")).toBeInTheDocument();
  });

  it("past its close: no button, waiting for the draw", () => {
    render(<GiveawayCard giveaway={card({ status: "closed", closesAt: new Date(NOW - 60_000).toISOString() })} />);
    expect(screen.queryByRole("button", { name: /Participar|Salir/ })).toBeNull();
    expect(screen.getByText("Esperando el sorteo")).toBeInTheDocument();
  });

  it("a drawn giveaway lists its winners, and says so when I won", () => {
    render(
      <GiveawayCard
        giveaway={card({
          status: "drawn",
          closesAt: new Date(NOW - 3600_000).toISOString(),
          winners: [
            { rank: 1, label: "@ana", iWon: false },
            { rank: 3, label: "@leo", iWon: true },
          ],
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Participar|Salir/ })).toBeNull();
    expect(screen.getByText("Sorteado")).toBeInTheDocument();
    expect(screen.getByText("@ana")).toBeInTheDocument();
    expect(screen.getByText("Has ganado")).toBeInTheDocument();
  });

  it("void and cancelled have their own label", () => {
    const { unmount } = render(<GiveawayCard giveaway={card({ status: "void", entryCount: 0 })} />);
    expect(screen.getByText("Sin participantes")).toBeInTheDocument();
    unmount();
    render(<GiveawayCard giveaway={card({ status: "cancelled" })} />);
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
  });
});
