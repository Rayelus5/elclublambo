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
// A 66-character hash typed key by key costs about a second per test (each keystroke re-renders the dialog), and several
// seconds under the full parallel suite: past the 5 s timeout. Typing is not what these tests check, so the hash is pasted.
const enterHash = async (value: string) => {
  await userEvent.click(screen.getByLabelText("Hash de la transacción"));
  await userEvent.paste(value);
};
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
    await enterHash(`  ${HASH} `);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(markRafflePaidAction).toHaveBeenCalledWith("r1", HASH);
    expect(await screen.findByText("Pago verificado. El sorteo quedará pagado cuando la red lo finalice.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["payout_pending", "La transacción aún no tiene confirmaciones suficientes. Vuelve a intentarlo en un momento."],
    ["tx_mismatch", "La transacción no coincide con el pago."],
  ])("shows the copy of %s", async (code, error) => {
    markRafflePaidAction.mockResolvedValue({ ok: false, code, error });
    open();
    await enterHash(HASH);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });

  it("F4-R3: tx_already_used explains when a combined payout is accepted", async () => {
    markRafflePaidAction.mockResolvedValue({ ok: false, code: "tx_already_used", error: "Esta transacción ya se usó." });
    open();
    await enterHash(HASH);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esta transacción ya está registrada como otro pago. Solo vale para este premio si la misma transferencia pagó también la retirada aprobada de este ganador, en USDC, a su wallet y por al menos la suma de los dos importes.",
    );
  });
});
