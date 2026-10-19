import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setWeightedRafflesEnabledAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffle-actions", () => ({ setWeightedRafflesEnabledAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { WeightedRafflesSwitch } from "@/components/treasury/treasurer/weighted-raffles-switch";

beforeEach(() => setWeightedRafflesEnabledAction.mockReset());

describe("WeightedRafflesSwitch", () => {
  it("has one switch per network and warns on mainnet", () => {
    render(<WeightedRafflesSwitch enabled={{ 59144: false, 59141: true }} />);
    expect(screen.getByRole("switch", { name: "Sorteos ponderados en Linea" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Sorteos ponderados en Linea Sepolia" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Recomendado solo tras una revisión legal.")).toHaveLength(1);
  });

  it("toggles through the action", async () => {
    setWeightedRafflesEnabledAction.mockResolvedValue({ ok: true });
    render(<WeightedRafflesSwitch enabled={{ 59144: false, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Sorteos ponderados en Linea Sepolia" }));
    expect(setWeightedRafflesEnabledAction).toHaveBeenCalledWith(59141, true);
    expect(await screen.findByText("Activados")).toBeInTheDocument();
  });

  it("asks before turning mainnet ON; cancelling changes nothing", async () => {
    setWeightedRafflesEnabledAction.mockResolvedValue({ ok: true });
    render(<WeightedRafflesSwitch enabled={{ 59144: false, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Sorteos ponderados en Linea" }));
    expect(screen.getByRole("dialog", { name: "Activar sorteos ponderados en Linea" })).toBeInTheDocument();
    expect(setWeightedRafflesEnabledAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(setWeightedRafflesEnabledAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("switch", { name: "Sorteos ponderados en Linea" }));
    await userEvent.click(screen.getByRole("button", { name: "Activar sorteos ponderados" }));
    expect(setWeightedRafflesEnabledAction).toHaveBeenCalledWith(59144, true);
  });

  it("turning mainnet OFF needs no confirmation", async () => {
    setWeightedRafflesEnabledAction.mockResolvedValue({ ok: true });
    render(<WeightedRafflesSwitch enabled={{ 59144: true, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Sorteos ponderados en Linea" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setWeightedRafflesEnabledAction).toHaveBeenCalledWith(59144, false);
  });

  it("keeps the old state and shows the error when the action fails", async () => {
    setWeightedRafflesEnabledAction.mockResolvedValue({ ok: false, code: "forbidden", error: "No tienes permiso para hacer esto." });
    render(<WeightedRafflesSwitch enabled={{ 59144: false, 59141: false }} />);
    await userEvent.click(screen.getByRole("switch", { name: "Sorteos ponderados en Linea Sepolia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso");
    expect(screen.getByRole("switch", { name: "Sorteos ponderados en Linea Sepolia" })).toHaveAttribute("aria-checked", "false");
  });
});
