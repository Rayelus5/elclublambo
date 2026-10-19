import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rejectWithdrawalAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ rejectWithdrawalAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RejectDialog } from "@/components/treasury/treasurer/reject-dialog";

beforeEach(() => {
  rejectWithdrawalAction.mockReset();
  refresh.mockReset();
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

  it("with an unexplained USDC outflow to the wallet after the approval: warns and needs an explicit confirmation", async () => {
    rejectWithdrawalAction.mockResolvedValue({ ok: true });
    render(<RejectDialog requestId="r1" approved unexplainedOutflow open onOpenChange={() => {}} />);
    expect(
      screen.getByText("Hay una salida de USDC a esta wallet sin explicar después de la aprobación. Si ya pagaste, usa «Marcar como pagada»."),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Motivo"), "Sin fondos");
    const btn = screen.getByRole("button", { name: "Rechazar" });
    expect(btn).toBeDisabled();
    const confirm = screen.getByRole("checkbox", { name: /no es el pago de esta retirada/ });
    await userEvent.click(confirm);
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(rejectWithdrawalAction).toHaveBeenCalledWith("r1", "Sin fondos");
  });

  it("without that outflow there is no warning nor confirmation", () => {
    render(<RejectDialog requestId="r1" approved open onOpenChange={() => {}} />);
    expect(screen.queryByText(/sin explicar después de la aprobación/)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("explains the refusal while a detected payout waits for verification (R3)", async () => {
    rejectWithdrawalAction.mockResolvedValue({ ok: false, code: "invalid_state", error: "Esta operación ya no se puede procesar en su estado actual." });
    render(<RejectDialog requestId="r1" approved open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Motivo"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Hay un pago detectado pendiente de verificar");
  });
});
