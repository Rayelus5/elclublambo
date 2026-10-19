import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markRafflePaidAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffle-actions", () => ({ markRafflePaidAction }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MarkRafflePaidDialog } from "@/components/treasury/treasurer/mark-raffle-paid-dialog";
import type { TreasuryRaffle } from "@/lib/treasury/raffles";

const raffle = { id: "r1", title: "Sorteo de otoño", prizeToken: "WETH", prizeAmount: 10n ** 16n, winnerLabel: "@ana" } as TreasuryRaffle;
const HASH = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  markRafflePaidAction.mockReset();
  refresh.mockReset();
});

function open() {
  render(<MarkRafflePaidDialog raffle={raffle} open onOpenChange={() => {}} />);
}

describe("MarkRafflePaidDialog", () => {
  it("names the prize and asks for the hash", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Marcar como pagado" })).toBeInTheDocument();
    expect(screen.getByText(/0,01 WETH/)).toBeInTheDocument();
    expect(screen.getByLabelText("Hash de la transacción")).toBeInTheDocument();
  });

  it("rejects a malformed hash without calling the action", async () => {
    open();
    await userEvent.type(screen.getByLabelText("Hash de la transacción"), "0x1234");
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(markRafflePaidAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("64 caracteres");
  });

  it("verifies, thanks and refreshes", async () => {
    markRafflePaidAction.mockResolvedValue({ ok: true, status: "recorded" });
    open();
    await userEvent.type(screen.getByLabelText("Hash de la transacción"), `  ${HASH} `);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(markRafflePaidAction).toHaveBeenCalledWith("r1", HASH);
    expect(await screen.findByText("Pago verificado. El sorteo quedará pagado cuando la red lo finalice.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["payout_pending", "La transacción aún no tiene confirmaciones suficientes. Vuelve a intentarlo en un momento."],
    ["tx_mismatch", "La transacción no coincide con el pago."],
    ["tx_already_used", "Esta transacción ya se usó."],
  ])("shows the copy of %s", async (code, error) => {
    markRafflePaidAction.mockResolvedValue({ ok: false, code, error });
    open();
    await userEvent.type(screen.getByLabelText("Hash de la transacción"), HASH);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });
});
