import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markWithdrawalPaidAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ markWithdrawalPaidAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MarkPaidDialog } from "@/components/treasury/treasurer/mark-paid-dialog";

// A 66-character hash typed key by key costs about a second per test (each keystroke re-renders the dialog), and several
// seconds under the full parallel suite: past the 5 s timeout. Typing is not what these tests check, so the hash is pasted.
const enterHash = async (value: string) => {
  await userEvent.click(screen.getByLabelText("Hash de la transacción"));
  await userEvent.paste(value);
};
const HASH = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  markWithdrawalPaidAction.mockReset();
  refresh.mockReset();
});

describe("MarkPaidDialog", () => {
  it("says the payout must be one transfer of at least the fixed amount, never split", () => {
    render(<MarkPaidDialog requestId="r1" open onOpenChange={() => {}} />);
    expect(screen.getByText(/una sola transferencia de al menos el importe fijado/)).toBeInTheDocument();
    expect(screen.getByText(/no se admiten pagos repartidos/i)).toBeInTheDocument();
  });

  it("validates the hash before calling", async () => {
    render(<MarkPaidDialog requestId="r1" open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Hash de la transacción"), "0x123");
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(markWithdrawalPaidAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("0x");
  });

  it("verifies a valid hash and explains that the shares burn at finality", async () => {
    markWithdrawalPaidAction.mockResolvedValue({ ok: true, status: "recorded" });
    render(<MarkPaidDialog requestId="r1" open onOpenChange={() => {}} />);
    await enterHash(` ${HASH} `);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(markWithdrawalPaidAction).toHaveBeenCalledWith("r1", HASH);
    expect(await screen.findByText("Pago verificado. Las participaciones se quemarán cuando la red lo finalice.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["payout_pending", "La transacción aún no tiene confirmaciones suficientes. Vuelve a intentarlo en un momento."],
    ["tx_mismatch", "La transacción no coincide con el pago."],
    ["tx_already_used", "Esta transacción ya se usó."],
    ["approval_expired", "La aprobación de esta retirada caducó. Vuelve a aprobarla al precio actual."],
  ])("shows the copy for %s", async (code, error) => {
    markWithdrawalPaidAction.mockResolvedValue({ ok: false, code, error });
    render(<MarkPaidDialog requestId="r1" open onOpenChange={() => {}} />);
    await enterHash(HASH);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });
});
