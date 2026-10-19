import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestWithdrawalAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ requestWithdrawalAction, cancelWithdrawalAction: vi.fn() }));

import { WithdrawButton } from "@/components/treasury/withdraw-button";
import { WithdrawControls } from "@/components/treasury/withdraw-controls";
import { WithdrawDialog } from "@/components/treasury/withdraw-dialog";
import type { DaoOverview } from "@/lib/treasury/queries";

const TEN = 10n * 10n ** 18n;
const PRICE = 2_000_000n;

beforeEach(() => requestWithdrawalAction.mockReset());

function dialog(open = true) {
  return render(<WithdrawDialog open={open} onOpenChange={() => {}} myShares={TEN} sharePriceUsd6={PRICE} />);
}

describe("WithdrawButton", () => {
  it("opens the dialog", async () => {
    render(<WithdrawButton myShares={TEN} sharePriceUsd6={PRICE} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect(screen.getByRole("dialog", { name: "Retirar participaciones" })).toBeInTheDocument();
  });
});

describe("WithdrawDialog", () => {
  it("has a slider and a text field kept in sync", () => {
    dialog();
    const slider = screen.getByLabelText("Porcentaje a retirar") as HTMLInputElement;
    const text = screen.getByLabelText("Porcentaje (%)") as HTMLInputElement;
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "100");
    expect(slider).toHaveAttribute("step", "1");
    fireEvent.change(slider, { target: { value: "40" } });
    expect(text.value).toBe("40");
    fireEvent.change(text, { target: { value: "12,5" } });
    expect(Number(slider.value)).toBe(12.5);
    fireEvent.change(text, { target: { value: "100" } });
    expect(slider.value).toBe("100");
    expect(screen.getByRole("button", { name: "Pedir retirada" })).toBeEnabled();
  });

  it("estimates the payout in USDC and always shows the lock warning", () => {
    dialog();
    fireEvent.change(screen.getByLabelText("Porcentaje a retirar"), { target: { value: "40" } });
    expect(
      screen.getByText("≈ 8 USDC al valor actual. El importe final se fija cuando el tesorero aprueba la retirada."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tus participaciones quedan bloqueadas desde que confirmas: dejan de contar para los canales con candado. Las retiradas dependen de la disponibilidad y de la decisión del tesorero.",
      ),
    ).toBeInTheDocument();
  });

  it("gives the slider a spoken value and links it to the estimate", () => {
    dialog();
    const slider = screen.getByLabelText("Porcentaje a retirar");
    fireEvent.change(slider, { target: { value: "40" } });
    expect(slider).toHaveAttribute("aria-valuetext", "40 por ciento");
    expect(slider).toHaveAttribute("aria-describedby", "withdraw-estimate");
  });

  it("scrolls on short screens", () => {
    dialog();
    expect(screen.getByRole("dialog").className).toMatch(/max-h-/);
    expect(screen.getByRole("dialog").className).toMatch(/overflow-y-auto/);
  });

  it("hides the estimate when the share price is 0", () => {
    render(<WithdrawDialog open onOpenChange={() => {}} myShares={TEN} sharePriceUsd6={0n} />);
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(screen.getByRole("button", { name: "Pedir retirada" })).toBeEnabled();
  });

  it("refuses an invalid percentage", () => {
    dialog();
    fireEvent.change(screen.getByLabelText("Porcentaje (%)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Pedir retirada" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Porcentaje (%)"), { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Pedir retirada" })).toBeDisabled();
  });

  it("requests the shares once, even on a double click", () => {
    let resolve!: (v: unknown) => void;
    requestWithdrawalAction.mockReturnValue(new Promise((r) => (resolve = r)));
    dialog();
    fireEvent.change(screen.getByLabelText("Porcentaje a retirar"), { target: { value: "40" } });
    const button = screen.getByRole("button", { name: "Pedir retirada" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(requestWithdrawalAction).toHaveBeenCalledTimes(1);
    expect(requestWithdrawalAction).toHaveBeenCalledWith({ shares: "4000000000000000000" });
    expect(button).toBeDisabled();
    resolve({ ok: true, id: "x" });
  });

  it("sends every share at 100 %", async () => {
    requestWithdrawalAction.mockResolvedValue({ ok: true, id: "x" });
    dialog();
    fireEvent.change(screen.getByLabelText("Porcentaje (%)"), { target: { value: "100" } });
    await userEvent.click(screen.getByRole("button", { name: "Pedir retirada" }));
    expect(requestWithdrawalAction).toHaveBeenCalledWith({ shares: TEN.toString() });
  });

  it("shows the mapped Spanish error", async () => {
    requestWithdrawalAction.mockResolvedValue({
      ok: false,
      code: "withdrawal_exists",
      error: "Ya tienes una retirada en curso. Cancélala o espera a que se resuelva.",
    });
    dialog();
    await userEvent.click(screen.getByRole("button", { name: "Pedir retirada" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ya tienes una retirada en curso."));
    expect(screen.getByRole("button", { name: "Pedir retirada" })).toBeEnabled();
  });
});

const overview = {
  chainId: 59141,
  myShares: TEN,
  sharePriceUsd6: PRICE,
  withdrawalsEnabled: true,
  myLockedShares: 0n,
  myWithdrawal: null,
} as unknown as DaoOverview;

const withdrawal = (status: "pending" | "cancelled") =>
  ({
    id: "1",
    status,
    shares: TEN,
    amountUsdc: null,
    approvedAt: null,
    expiresAt: null,
    payoutRecorded: false,
    payoutTxHash: null,
    rejectReason: null,
    lastExpiredAt: null,
    createdAt: "2026-10-18T10:00:00Z",
  }) as const;

describe("WithdrawControls", () => {
  it("shows the button when enabled, with shares and no request", () => {
    render(<WithdrawControls data={overview} />);
    expect(screen.getByRole("button", { name: "Retirar" })).toBeInTheDocument();
  });
  it("shows nothing with the switch off or without shares", () => {
    const { container, rerender } = render(<WithdrawControls data={{ ...overview, withdrawalsEnabled: false }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WithdrawControls data={{ ...overview, myShares: 0n }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the status instead of the button while a request is active", () => {
    render(<WithdrawControls data={{ ...overview, myWithdrawal: withdrawal("pending") }} />);
    expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });
  it("shows a closed request's status with the button, and the status alone with the switch off", () => {
    const w = withdrawal("cancelled");
    const { rerender } = render(<WithdrawControls data={{ ...overview, myWithdrawal: w }} />);
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirar" })).toBeInTheDocument();
    rerender(<WithdrawControls data={{ ...overview, withdrawalsEnabled: false, myWithdrawal: w }} />);
    expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
  });
});
