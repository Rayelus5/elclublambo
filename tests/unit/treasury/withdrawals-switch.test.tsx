import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setWithdrawalsEnabledAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/withdrawal-actions", () => ({ setWithdrawalsEnabledAction }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { WithdrawalsSwitch } from "@/components/treasury/treasurer/withdrawals-switch";

beforeEach(() => setWithdrawalsEnabledAction.mockReset());

describe("WithdrawalsSwitch", () => {
  it("has one switch per network and warns on mainnet", () => {
    render(<WithdrawalsSwitch enabled={{ 59144: false, 59141: true }} />);
    expect(screen.getByRole("switch", { name: "Retiradas en Linea" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Recomendado solo tras una revisión legal.")).toHaveLength(1);
  });

  it("toggles through the action and shows the new state", async () => {
    setWithdrawalsEnabledAction.mockResolvedValue({ ok: true });
    render(<WithdrawalsSwitch enabled={{ 59144: false, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" }));
    expect(setWithdrawalsEnabledAction).toHaveBeenCalledWith(59141, true);
    expect(await screen.findByText("Activadas")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" })).toHaveAttribute("aria-checked", "true");
  });

  it("asks for confirmation before turning mainnet ON, and cancelling changes nothing", async () => {
    setWithdrawalsEnabledAction.mockResolvedValue({ ok: true });
    render(<WithdrawalsSwitch enabled={{ 59144: false, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Retiradas en Linea" }));
    expect(screen.getByRole("dialog", { name: "Activar retiradas en Linea" })).toBeInTheDocument();
    expect(setWithdrawalsEnabledAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(setWithdrawalsEnabledAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("switch", { name: "Retiradas en Linea" }));
    await userEvent.click(screen.getByRole("button", { name: "Activar retiradas" }));
    expect(setWithdrawalsEnabledAction).toHaveBeenCalledWith(59144, true);
    expect(await screen.findByText("Activadas")).toBeInTheDocument();
  });

  it("turning mainnet OFF needs no confirmation", async () => {
    setWithdrawalsEnabledAction.mockResolvedValue({ ok: true });
    render(<WithdrawalsSwitch enabled={{ 59144: true, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Retiradas en Linea" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setWithdrawalsEnabledAction).toHaveBeenCalledWith(59144, false);
  });

  it("re-syncs when the server's values change", () => {
    const { rerender } = render(<WithdrawalsSwitch enabled={{ 59144: false, 59141: false }} />);
    rerender(<WithdrawalsSwitch enabled={{ 59144: false, 59141: true }} />);
    expect(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the old state and shows the error when the action fails", async () => {
    setWithdrawalsEnabledAction.mockResolvedValue({ ok: false, code: "forbidden", error: "No tienes permiso para hacer esto." });
    render(<WithdrawalsSwitch enabled={{ 59144: false, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso");
    expect(screen.getByRole("switch", { name: "Retiradas en Linea Sepolia" })).toHaveAttribute("aria-checked", "false");
  });
});
