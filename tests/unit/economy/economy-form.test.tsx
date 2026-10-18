import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setActiveChainAction = vi.hoisted(() => vi.fn());
const setMinFeeBpsAction = vi.hoisted(() => vi.fn());
const setChainAddressesAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const cancelOpenDonationIntentsAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/economy/actions", () => ({
  setActiveChainAction,
  setMinFeeBpsAction,
  setChainAddressesAction,
  cancelOpenDonationIntentsAction,
}));

import { EconomyForm } from "@/components/economy/economy-form";
import type { EconomyConfig } from "@/lib/economy/config";

const SAFE = "0x1111111111111111111111111111111111111111";
const PLAT = "0x2222222222222222222222222222222222222222";

const config: EconomyConfig = {
  activeChainId: 59141,
  minFeeBps: 260,
  chains: {
    59141: { safe: SAFE, platform: PLAT },
    59144: { safe: null, platform: null },
  },
};

beforeEach(() => {
  refresh.mockReset();
  setActiveChainAction.mockReset().mockResolvedValue({});
  setMinFeeBpsAction.mockReset().mockResolvedValue({});
  setChainAddressesAction.mockReset().mockResolvedValue({});
  cancelOpenDonationIntentsAction.mockReset().mockResolvedValue({ count: 2 });
});

describe("EconomyForm", () => {
  it("asks for confirmation before switching network, warning about missing addresses", async () => {
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    await user.click(screen.getByRole("button", { name: "Cambiar a Linea" }));
    expect(await screen.findByText("Los envíos de dinero pasarán a Linea. ¿Continuar?")).toBeInTheDocument();
    expect(screen.getByText(/Linea aún no tiene configurada la Safe ni la wallet de la plataforma/)).toBeInTheDocument();
    expect(setActiveChainAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(setActiveChainAction).toHaveBeenCalledWith(59144));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an inline error for an invalid address and does not call the action", async () => {
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    const safe = screen.getByLabelText("Safe (Linea)");
    await user.type(safe, "0x123");
    await user.click(screen.getByRole("button", { name: "Guardar direcciones de Linea" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/dirección/i);
    expect(setChainAddressesAction).not.toHaveBeenCalled();
  });

  it("always sends both addresses of the chain", async () => {
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    await user.type(screen.getByLabelText("Safe (Linea)"), SAFE);
    await user.click(screen.getByRole("button", { name: "Guardar direcciones de Linea" }));
    await waitFor(() =>
      expect(setChainAddressesAction).toHaveBeenCalledWith({ chain: 59144, safe: SAFE, platform: null }),
    );
  });

  it("explains a refused Safe change (F4a-R12) and keeps the form unsaved", async () => {
    setChainAddressesAction.mockResolvedValue({ error: "safe_change_blocked" });
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    const safe = screen.getByLabelText("Safe (Linea Sepolia)");
    await user.clear(safe);
    await user.type(safe, "0x3333333333333333333333333333333333333333");
    await user.click(screen.getByRole("button", { name: "Guardar direcciones de Linea Sepolia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No puedes cambiar la Safe de esta red/);
    expect(screen.queryByText("Direcciones guardadas.")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers to cancel open donation payments only after a refused Safe change (F4a carry c)", async () => {
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    expect(screen.queryByRole("button", { name: "Cancelar pagos de donación abiertos" })).not.toBeInTheDocument();

    setChainAddressesAction.mockResolvedValue({ error: "safe_change_blocked" });
    const safe = screen.getByLabelText("Safe (Linea Sepolia)");
    await user.clear(safe);
    await user.type(safe, "0x3333333333333333333333333333333333333333");
    await user.click(screen.getByRole("button", { name: "Guardar direcciones de Linea Sepolia" }));
    expect(await screen.findByRole("button", { name: "Cancelar pagos de donación abiertos" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cancela los pagos de donación que aún no tienen transacción. Si alguien está pagando justo ahora, su donación no se acreditará sola.",
      ),
    ).toBeInTheDocument();
    // only on the card whose Safe change was refused
    expect(screen.getAllByRole("button", { name: "Cancelar pagos de donación abiertos" })).toHaveLength(1);
  });

  async function refuseSafeChange(user: ReturnType<typeof userEvent.setup>) {
    setChainAddressesAction.mockResolvedValue({ error: "safe_change_blocked" });
    render(<EconomyForm config={config} />);
    const safe = screen.getByLabelText("Safe (Linea Sepolia)");
    await user.clear(safe);
    await user.type(safe, "0x3333333333333333333333333333333333333333");
    await user.click(screen.getByRole("button", { name: "Guardar direcciones de Linea Sepolia" }));
    return screen.findByRole("button", { name: "Cancelar pagos de donación abiertos" });
  }

  it("lets the cancel button label wrap (375 px)", async () => {
    const user = userEvent.setup();
    const button = await refuseSafeChange(user);
    expect(button.className).toContain("whitespace-normal");
  });

  it("asks for confirmation before cancelling, and going back cancels nothing (F4c-R1)", async () => {
    const user = userEvent.setup();
    await user.click(await refuseSafeChange(user));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("¿Cancelar los pagos de donación abiertos?");
    expect(dialog).toHaveTextContent(/Linea Sepolia/);
    expect(cancelOpenDonationIntentsAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(cancelOpenDonationIntentsAction).not.toHaveBeenCalled();
  });

  it("cancels the open donation payments of that chain once confirmed and tells how many (plural)", async () => {
    const user = userEvent.setup();
    await user.click(await refuseSafeChange(user));
    await user.click(await screen.findByRole("button", { name: "Sí, cancelar pagos" }));
    await waitFor(() => expect(cancelOpenDonationIntentsAction).toHaveBeenCalledWith(59141));
    expect(await screen.findByText("2 pagos cancelados. Vuelve a guardar la Safe.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pagos de donación abiertos" })).not.toBeInTheDocument();
  });

  it("uses the singular for one cancelled payment (F4c-R1)", async () => {
    cancelOpenDonationIntentsAction.mockResolvedValue({ count: 1 });
    const user = userEvent.setup();
    await user.click(await refuseSafeChange(user));
    await user.click(await screen.findByRole("button", { name: "Sí, cancelar pagos" }));
    expect(await screen.findByText("1 pago cancelado. Vuelve a guardar la Safe.")).toBeInTheDocument();
  });

  it("shows a cancel error without hiding why the Safe change was refused", async () => {
    cancelOpenDonationIntentsAction.mockResolvedValue({ error: "forbidden" });
    const user = userEvent.setup();
    await user.click(await refuseSafeChange(user));
    await user.click(await screen.findByRole("button", { name: "Sí, cancelar pagos" }));
    expect(await screen.findByText("No tienes permiso para hacer esto.")).toBeInTheDocument();
    expect(screen.getByText(/No puedes cambiar la Safe de esta red/)).toBeInTheDocument();
  });

  it("previews the fee on 10 USDC and saves it in bps", async () => {
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    expect(screen.getByText("Sobre 10 USDC: 0,26 USDC")).toBeInTheDocument();
    const fee = screen.getByLabelText("Comisión mínima (%)");
    await user.clear(fee);
    await user.type(fee, "5");
    expect(screen.getByText("Sobre 10 USDC: 0,50 USDC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar comisión" }));
    await waitFor(() => expect(setMinFeeBpsAction).toHaveBeenCalledWith(500));
  });

  it("keeps the saved confirmations when the refreshed config arrives with the new values", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<EconomyForm config={config} />);
    const fee = screen.getByLabelText("Comisión mínima (%)");
    await user.clear(fee);
    await user.type(fee, "5");
    await user.click(screen.getByRole("button", { name: "Guardar comisión" }));
    expect(await screen.findByText("Comisión guardada.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Safe (Linea)"), SAFE);
    await user.click(screen.getByRole("button", { name: "Guardar direcciones de Linea" }));
    expect(await screen.findByText("Direcciones guardadas.")).toBeInTheDocument();

    // router.refresh() re-renders the page with the stored values.
    rerender(<EconomyForm config={{ ...config, minFeeBps: 500, chains: { ...config.chains, 59144: { safe: SAFE, platform: null } } }} />);
    expect(screen.getByText("Comisión guardada.")).toBeInTheDocument();
    expect(screen.getByText("Direcciones guardadas.")).toBeInTheDocument();
  });

  it("rejects an out-of-range fee inline", async () => {
    const user = userEvent.setup();
    render(<EconomyForm config={config} />);
    const fee = screen.getByLabelText("Comisión mínima (%)");
    await user.clear(fee);
    await user.type(fee, "51");
    await user.click(screen.getByRole("button", { name: "Guardar comisión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/0.*50/);
    expect(setMinFeeBpsAction).not.toHaveBeenCalled();
  });
});
