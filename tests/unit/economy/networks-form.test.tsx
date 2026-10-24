import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setChainEnabledAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/economy/actions", () => ({ setChainEnabledAction }));

import { NetworksForm } from "@/components/economy/networks-form";

const SAFE = "0x1111111111111111111111111111111111111111";
const chains = [
  { chainId: 84532 as const, enabled: true, safe: SAFE },
  { chainId: 421614 as const, enabled: false, safe: null },
];

beforeEach(() => {
  refresh.mockReset();
  setChainEnabledAction.mockReset().mockResolvedValue({ ok: true });
});

describe("NetworksForm", () => {
  it("renders one named switch per network with its state, each at least 44px tall", () => {
    render(<NetworksForm chains={chains} />);
    const on = screen.getByRole("switch", { name: "Habilitar Base Sepolia" });
    const off = screen.getByRole("switch", { name: "Habilitar Arbitrum Sepolia" });
    expect(on).toBeChecked();
    expect(off).not.toBeChecked();
    expect(on.className).toContain("min-h-11");
    expect(off.className).toContain("min-h-11");
  });

  it("shows the shortened Safe linking to the explorer, or that there is none", () => {
    render(<NetworksForm chains={chains} />);
    const link = screen.getByRole("link", { name: /0x1111…1111/ });
    expect(link).toHaveAttribute("href", expect.stringContaining(SAFE));
    expect(screen.getByText("Sin Safe configurada")).toBeInTheDocument();
  });

  it("enabling a network calls the action and refreshes", async () => {
    const user = userEvent.setup();
    render(<NetworksForm chains={chains} />);
    await user.click(screen.getByRole("switch", { name: "Habilitar Arbitrum Sepolia" }));
    await waitFor(() => expect(setChainEnabledAction).toHaveBeenCalledWith(421614, true));
    expect(refresh).toHaveBeenCalled();
  });

  it("an error shows as an alert and the switch keeps its state", async () => {
    setChainEnabledAction.mockResolvedValue({ ok: false, error: "forbidden" });
    const user = userEvent.setup();
    render(<NetworksForm chains={chains} />);
    await user.click(screen.getByRole("switch", { name: "Habilitar Arbitrum Sepolia" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Habilitar Arbitrum Sepolia" })).not.toBeChecked();
    expect(refresh).not.toHaveBeenCalled();
  });
});
