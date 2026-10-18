import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteWithdrawalAction = vi.hoisted(() => vi.fn());
const approveWithdrawalAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ quoteWithdrawalAction, approveWithdrawalAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ApproveDialog } from "@/components/treasury/treasurer/approve-dialog";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const quote = (over: Record<string, unknown> = {}) => ({
  ok: true,
  quote: { amountUsdc: "8000000", safeUsdc: "10000000", availableUsdc: "10000000", destination: WALLET, selfApproval: false, ...over },
});

beforeEach(() => {
  quoteWithdrawalAction.mockReset();
  approveWithdrawalAction.mockReset();
  refresh.mockReset();
});

function open() {
  return render(<ApproveDialog requestId="r1" open onOpenChange={() => {}} />);
}

describe("ApproveDialog", () => {
  it("quotes on open and shows the amount that will be fixed, the available USDC and the full destination", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote());
    open();
    expect(screen.getByRole("dialog", { name: "Aprobar retirada" })).toBeInTheDocument();
    expect(await screen.findByText("Importe que se fijará: 8 USDC")).toBeInTheDocument();
    expect(quoteWithdrawalAction).toHaveBeenCalledWith("r1");
    expect(screen.getByText("USDC disponible en la Safe: 10 USDC")).toBeInTheDocument();
    expect(screen.getByText(WALLET)).toHaveClass("font-mono");
    expect(screen.getByText(/Wallet de destino:/)).toBeInTheDocument();
    expect(screen.queryByText(/vende ETH/)).toBeNull();
    expect(screen.queryByText(/propia retirada/)).toBeNull();
    expect(screen.getByRole("button", { name: "Aprobar y fijar importe" })).toBeEnabled();
  });

  it("warns, without blocking, when the Safe has less USDC than the amount", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote({ availableUsdc: "3000000", safeUsdc: "3000000" }));
    open();
    expect(await screen.findByText("No hay USDC suficiente en la Safe: vende ETH antes de pagar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar y fijar importe" })).toBeEnabled();
  });

  it("flags a self-approval", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote({ selfApproval: true }));
    open();
    expect(await screen.findByText("Es tu propia retirada: quedará registrada y marcada en el panel.")).toBeInTheDocument();
  });

  it("approves, then explains what to do next", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote());
    approveWithdrawalAction.mockResolvedValue({ ok: true, amountUsdc: "8000000" });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar y fijar importe" }));
    expect(approveWithdrawalAction).toHaveBeenCalledWith("r1");
    expect(
      await screen.findByText("Aprobada por 8 USDC. Paga desde la Safe y pega aquí el hash, o el foro detectará la transferencia."),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Aprobar y fijar importe" })).toBeNull();
  });

  it("shows the valuation error and keeps the confirm button disabled", async () => {
    quoteWithdrawalAction.mockResolvedValue({
      ok: false,
      code: "valuation_unavailable",
      error: "No se puede valorar el fondo ahora mismo (precio o red no disponibles). Inténtalo en unos minutos.",
    });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se puede valorar el fondo ahora mismo");
    expect(screen.getByRole("button", { name: "Aprobar y fijar importe" })).toBeDisabled();
  });

  it("shows an approval error", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote());
    approveWithdrawalAction.mockResolvedValue({ ok: false, code: "invalid_state", error: "Esta operación ya no se puede procesar en su estado actual." });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar y fijar importe" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ya no se puede procesar"));
  });

  it("does not approve twice on a double click", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote());
    approveWithdrawalAction.mockReturnValue(new Promise(() => {}));
    open();
    const btn = await screen.findByRole("button", { name: "Aprobar y fijar importe" });
    await userEvent.dblClick(btn);
    expect(approveWithdrawalAction).toHaveBeenCalledTimes(1);
  });

  it("repeats the banned flag where the decision is made", async () => {
    quoteWithdrawalAction.mockResolvedValue(quote());
    render(<ApproveDialog requestId="r1" banned open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Miembro baneado/)).toBeInTheDocument();
  });

  it("offers a retry when the quote fails", async () => {
    quoteWithdrawalAction.mockResolvedValueOnce({ ok: false, code: "rpc_unavailable", error: "No pudimos consultar la red." });
    quoteWithdrawalAction.mockResolvedValueOnce(quote());
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Importe que se fijará: 8 USDC")).toBeInTheDocument();
    expect(quoteWithdrawalAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });
});
