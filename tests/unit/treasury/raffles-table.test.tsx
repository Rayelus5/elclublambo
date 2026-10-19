import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createRaffleAction: vi.fn(),
  cancelRaffleAction: vi.fn(),
  markRafflePaidAction: vi.fn(),
  setWeightedRafflesEnabledAction: vi.fn(),
}));
vi.mock("@/lib/treasury/raffle-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RafflesTable } from "@/components/treasury/treasurer/raffles-table";
import type { TreasuryRaffle } from "@/lib/treasury/raffles";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

export const raffle = (over: Partial<TreasuryRaffle> = {}): TreasuryRaffle => ({
  id: "r1",
  title: "Sorteo de otoño",
  status: "open",
  prizeToken: "USDC",
  prizeAmount: 50_000_000n,
  prizeValueUsd6: 50_000_000n,
  mode: "equal",
  closesAt: "2026-10-25T16:30:00Z",
  entries: 3,
  totalWeight: null,
  winnerMemberId: null,
  winnerLabel: null,
  winnerAddress: null,
  drawnAt: null,
  unpaid: false,
  payoutTxHash: null,
  payoutRecordedAt: null,
  paidAt: null,
  cancelReason: null,
  createdByLabel: "@tes",
  createdAt: "2026-10-19T10:00:00Z",
  paidLate: false,
  drawRefused: null,
  ...over,
});

const drawn = (over: Partial<TreasuryRaffle> = {}) =>
  raffle({ status: "drawn", winnerMemberId: "w1", winnerLabel: "@ana", winnerAddress: WALLET, drawnAt: "2026-10-26T00:00:00Z", ...over });

beforeEach(() => Object.values(actions).forEach((f) => f.mockReset()));

describe("RafflesTable", () => {
  it("shows title, status label, prize, close date, participants and mode", () => {
    render(<RafflesTable rows={[raffle()]} bannedIds={[]} chainId={59141} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Sorteo de otoño")).toBeInTheDocument();
    expect(within(item).getByText("Abierto")).toBeInTheDocument();
    expect(within(item).getByText(/50 USDC/)).toBeInTheDocument();
    expect(within(item).getByText(/25 oct 2026/)).toBeInTheDocument();
    expect(within(item).getByText("Participantes: 3")).toBeInTheDocument();
    expect(within(item).getByText("Igualitario")).toBeInTheDocument();
  });

  it("labels the weighted mode and a WETH prize", () => {
    render(<RafflesTable rows={[raffle({ mode: "weighted", prizeToken: "WETH", prizeAmount: 10n ** 16n })]} bannedIds={[]} chainId={59141} />);
    expect(screen.getByText("Ponderado por participación")).toBeInTheDocument();
    expect(screen.getByText(/0,01 WETH/)).toBeInTheDocument();
  });

  it("says when there are no raffles", () => {
    render(<RafflesTable rows={[]} bannedIds={[]} chainId={59141} />);
    expect(screen.getByText("No hay sorteos activos ni recientes.")).toBeInTheDocument();
  });

  it("open and closed rows offer «Cancelar sorteo»; the dialog needs a reason", async () => {
    actions.cancelRaffleAction.mockResolvedValue({ ok: true });
    render(<RafflesTable rows={[raffle(), raffle({ id: "r2", status: "closed" })]} bannedIds={[]} chainId={59141} />);
    expect(screen.getAllByRole("button", { name: "Cancelar sorteo" })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole("button", { name: "Cancelar sorteo" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Cancelar sorteo" });
    const button = within(dialog).getByRole("button", { name: "Cancelar sorteo" });
    expect(button).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Motivo"), "  Error en el premio ");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(actions.cancelRaffleAction).toHaveBeenCalledWith("r1", "Error en el premio");
  });

  it("shows the refusal of a cancel", async () => {
    actions.cancelRaffleAction.mockResolvedValue({ ok: false, code: "raffle_drawn", error: "Un sorteo ya resuelto no se puede cancelar: el premio es del ganador." });
    render(<RafflesTable rows={[raffle()]} bannedIds={[]} chainId={59141} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancelar sorteo" }));
    await userEvent.type(screen.getByLabelText("Motivo"), "x");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar sorteo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("el premio es del ganador");
  });

  it("a drawn row shows the real winner, the full wallet with copy and «Marcar como pagado»; no cancel", () => {
    render(<RafflesTable rows={[drawn()]} bannedIds={[]} chainId={59141} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Ganador: @ana")).toBeInTheDocument();
    expect(within(item).getByText(WALLET)).toBeInTheDocument();
    expect(within(item).getByText("Wallet:")).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: /Copiar la wallet/ })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Marcar como pagado" })).toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: "Cancelar sorteo" })).toBeNull();
    expect(within(item).queryByText("Impagado")).toBeNull();
    expect(within(item).queryByText("Miembro baneado")).toBeNull();
  });

  it("flags Impagado and a banned winner (who keeps the prize)", () => {
    render(<RafflesTable rows={[drawn({ unpaid: true })]} bannedIds={["w1"]} chainId={59141} />);
    expect(screen.getByText("Impagado")).toBeInTheDocument();
    expect(screen.getByText("Miembro baneado")).toBeInTheDocument();
    expect(screen.getByText("Impagado · más de 14 días sin pagar")).toBeInTheDocument();
  });

  it("with a payout recorded there is no «Marcar como pagado»", () => {
    render(<RafflesTable rows={[drawn({ payoutTxHash: `0x${"a".repeat(64)}`, payoutRecordedAt: "2026-10-27T00:00:00Z" })]} bannedIds={[]} chainId={59141} />);
    expect(screen.getByText("Pago detectado · esperando finalidad")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como pagado" })).toBeNull();
  });

  it("shows the reason of a cancelled raffle and «Sin ganador» for a void one, with no actions", () => {
    render(
      <RafflesTable rows={[raffle({ status: "cancelled", cancelReason: "Premio mal puesto" }), raffle({ id: "r2", status: "void" })]} bannedIds={[]} chainId={59141} />,
    );
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(screen.getByText("Motivo: Premio mal puesto")).toBeInTheDocument();
    expect(screen.getByText("Sin ganador")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a prize paid after the 14 days reads «Pagado con retraso», like the public raffle page", () => {
    const paid = { status: "paid" as const, payoutTxHash: `0x${"a".repeat(64)}`, payoutRecordedAt: "2026-11-12T00:00:00Z", paidAt: "2026-11-12T00:00:00Z" };
    render(<RafflesTable rows={[drawn({ ...paid, paidLate: true }), drawn({ ...paid, id: "r2", paidLate: false })]} bannedIds={[]} chainId={59141} />);
    const [late, onTime] = screen.getAllByRole("listitem");
    expect(within(late!).getByText("Pagado con retraso")).toBeInTheDocument();
    expect(within(onTime!).getByText("Pagado")).toBeInTheDocument();
  });

  it("a closed raffle whose draw was refused says so", () => {
    render(<RafflesTable rows={[raffle({ status: "closed", drawRefused: "draw_block_invalid" })]} bannedIds={[]} chainId={59141} />);
    expect(screen.getByText(/No se pudo hacer el sorteo/)).toBeInTheDocument();
  });

  it("opens the mark-paid dialog", async () => {
    render(<RafflesTable rows={[drawn()]} bannedIds={[]} chainId={59141} />);
    await userEvent.click(screen.getByRole("button", { name: "Marcar como pagado" }));
    expect(screen.getByRole("dialog", { name: "Marcar como pagado" })).toBeInTheDocument();
  });
});
