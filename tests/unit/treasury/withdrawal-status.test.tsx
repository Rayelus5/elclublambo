import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelWithdrawalAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ requestWithdrawalAction: vi.fn(), cancelWithdrawalAction }));

import { WithdrawalStatus } from "@/components/treasury/withdrawal-status";
import type { MyWithdrawal } from "@/lib/treasury/withdrawals";

const HASH = `0x${"cd".repeat(32)}`;
const base: MyWithdrawal = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "pending",
  shares: 4n * 10n ** 18n,
  amountUsdc: null,
  approvedAt: null,
  expiresAt: null,
  payoutRecorded: false,
  payoutTxHash: null,
  rejectReason: null,
  lastExpiredAt: null,
  createdAt: "2026-10-18T10:00:00Z",
};
const show = (w: Partial<MyWithdrawal>) => render(<WithdrawalStatus withdrawal={{ ...base, ...w }} chainId={59141} />);

beforeEach(() => cancelWithdrawalAction.mockReset());

describe("WithdrawalStatus", () => {
  it("pending: label and cancel", async () => {
    cancelWithdrawalAction.mockResolvedValue({ ok: true });
    show({});
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    expect(cancelWithdrawalAction).toHaveBeenCalledWith(base.id);
  });

  it("shows a cancel error", async () => {
    cancelWithdrawalAction.mockResolvedValue({ ok: false, code: "invalid_state", error: "No se puede en este estado." });
    show({});
    await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se puede en este estado."));
  });

  it("approved: fixed USDC amount, expiry, no cancel", () => {
    show({ status: "approved", amountUsdc: 8_000_000n, approvedAt: "2026-10-18T12:00:00Z", expiresAt: "2026-11-01T12:00:00Z" });
    expect(screen.getByText("Aprobada · importe fijado: 8 USDC")).toBeInTheDocument();
    expect(screen.getByText(/Caduca el .*2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).toBeNull();
  });

  it("payout recorded: waiting for finality", () => {
    show({ status: "approved", amountUsdc: 8_000_000n, payoutRecorded: true, payoutTxHash: HASH, expiresAt: "2026-11-01T12:00:00Z" });
    expect(screen.getByText("Pago detectado · esperando finalidad")).toBeInTheDocument();
    expect(screen.queryByText(/Caduca el/)).toBeNull();
  });

  it("paid: label and explorer link", () => {
    show({ status: "paid", amountUsdc: 8_000_000n, payoutRecorded: true, payoutTxHash: HASH });
    expect(screen.getByText("Pagada")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /explorador/i });
    expect(link).toHaveAttribute("href", expect.stringContaining(HASH));
  });

  it("rejected with the reason", () => {
    show({ status: "rejected", rejectReason: "Sin liquidez" });
    expect(screen.getByText("Rechazada: Sin liquidez")).toBeInTheDocument();
  });

  it("cancelled", () => {
    show({ status: "cancelled" });
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).toBeNull();
  });

  it("expired: label and cancel", () => {
    show({ lastExpiredAt: "2026-10-30T00:00:00Z" });
    expect(screen.getByText("Caducada · pendiente de nueva aprobación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar solicitud" })).toBeInTheDocument();
  });
});
