import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setActiveChainAction = vi.hoisted(() => vi.fn());
const setMinFeeBpsAction = vi.hoisted(() => vi.fn());
const setChainAddressesAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/economy/actions", () => ({ setActiveChainAction, setMinFeeBpsAction, setChainAddressesAction }));

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
