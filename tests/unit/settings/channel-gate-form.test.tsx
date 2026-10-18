import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setChannelGateAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/channels/actions", () => ({ setChannelGateAction }));

import { ChannelGateForm } from "@/components/settings/channel-gate-form";

const ID = "6f1c1c5e-0000-4000-8000-000000000001";

beforeEach(() => {
  refresh.mockReset();
  setChannelGateAction.mockReset();
  setChannelGateAction.mockResolvedValue({});
});

describe("ChannelGateForm", () => {
  it("starts from the current gate", () => {
    render(<ChannelGateForm channelId={ID} gate={{ minShareBps: 150, minNetUsdc: "100000000", scope: "post" }} />);
    expect(screen.getByLabelText("% mínimo de la DAO")).toHaveValue("1,5");
    expect(screen.getByLabelText("Aportación neta mínima (USDC)")).toHaveValue("100");
    expect(screen.getByRole("radio", { name: "Escribir" })).toBeChecked();
  });

  it("submits percent as bps, USDC as base units and the scope", async () => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText("% mínimo de la DAO"), "0,25");
    await user.type(screen.getByLabelText("Aportación neta mínima (USDC)"), "12,5");
    await user.click(screen.getByRole("radio", { name: "Escribir" }));
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    await waitFor(() =>
      expect(setChannelGateAction).toHaveBeenCalledWith({ id: ID, minShareBps: 25, minNetUsdc: "12500000", scope: "post" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("both empty clears the gate", async () => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} gate={{ minShareBps: 100, minNetUsdc: null, scope: "view" }} />);
    await user.clear(screen.getByLabelText("% mínimo de la DAO"));
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    await waitFor(() =>
      expect(setChannelGateAction).toHaveBeenCalledWith({ id: ID, minShareBps: null, minNetUsdc: null, scope: "view" }),
    );
  });

  it.each(["100,5", "101", "1,234", "abc"])("rejects %s as percent without calling the action", async (bad) => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText("% mínimo de la DAO"), bad);
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    expect(screen.getByLabelText("% mínimo de la DAO")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("entre 0 y 100");
    expect(setChannelGateAction).not.toHaveBeenCalled();
  });

  it.each(["-1", "1,1234567", "abc"])("rejects %s as net amount", async (bad) => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText("Aportación neta mínima (USDC)"), bad);
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    expect(screen.getByLabelText("Aportación neta mínima (USDC)")).toHaveAttribute("aria-invalid", "true");
    expect(setChannelGateAction).not.toHaveBeenCalled();
  });

  it("accepts 0 as a net minimum", async () => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText("Aportación neta mínima (USDC)"), "0");
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    await waitFor(() => expect(setChannelGateAction).toHaveBeenCalled());
  });

  it("shows the RPC error in Spanish", async () => {
    setChannelGateAction.mockResolvedValue({ error: "forbidden" });
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    expect(await screen.findByText("No tienes permiso para hacer esto.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
