import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markWithdrawalPaidAction = vi.hoisted(() => vi.fn());
const rejectWithdrawalAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ markWithdrawalPaidAction, rejectWithdrawalAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MarkPaidDialog } from "@/components/treasury/treasurer/mark-paid-dialog";
import { RejectDialog } from "@/components/treasury/treasurer/reject-dialog";

const HASH = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  markWithdrawalPaidAction.mockReset();
  rejectWithdrawalAction.mockReset();
  refresh.mockReset();
});

describe("MarkPaidDialog", () => {
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
    await userEvent.type(screen.getByLabelText("Hash de la transacción"), ` ${HASH} `);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(markWithdrawalPaidAction).toHaveBeenCalledWith("r1", HASH);
    expect(await screen.findByText("Pago verificado. Las participaciones se quemarán cuando la red lo finalice.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["payout_pending", "La transacción aún no tiene confirmaciones suficientes. Vuelve a intentarlo en un momento."],
    ["tx_mismatch", "La transacción no coincide con el pago."],
    ["approval_expired", "La aprobación de esta retirada caducó. Vuelve a aprobarla al precio actual."],
  ])("shows the copy for %s", async (code, error) => {
    markWithdrawalPaidAction.mockResolvedValue({ ok: false, code, error });
    render(<MarkPaidDialog requestId="r1" open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Hash de la transacción"), HASH);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar pago" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });
});

describe("RejectDialog", () => {
  it("needs a reason of 1 to 280 characters", async () => {
    render(<RejectDialog requestId="r1" open onOpenChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "Rechazar" });
    expect(btn).toBeDisabled();
    const box = screen.getByLabelText("Motivo");
    expect(box).toHaveAttribute("maxlength", "280");
    await userEvent.type(box, "   ");
    expect(btn).toBeDisabled();
    await userEvent.type(box, "Sin fondos");
    expect(btn).toBeEnabled();
  });

  it("rejects with the trimmed reason", async () => {
    rejectWithdrawalAction.mockResolvedValue({ ok: true });
    const onOpenChange = vi.fn();
    render(<RejectDialog requestId="r1" open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByLabelText("Motivo"), " Sin fondos ");
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(rejectWithdrawalAction).toHaveBeenCalledWith("r1", "Sin fondos");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("explains the refusal while a detected payout waits for verification (R3)", async () => {
    rejectWithdrawalAction.mockResolvedValue({ ok: false, code: "invalid_state", error: "Esta operación ya no se puede procesar en su estado actual." });
    render(<RejectDialog requestId="r1" approved open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Motivo"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Hay un pago detectado pendiente de verificar");
  });
});
