import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setChannelGateAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/channels/actions", () => ({ setChannelGateAction }));

import { ChannelGateForm } from "@/components/settings/channel-gate-form";

const ID = "6f1c1c5e-0000-4000-8000-000000000001";
const FIELD = "Donado mínimo (USD)";

beforeEach(() => {
  refresh.mockReset();
  setChannelGateAction.mockReset();
  setChannelGateAction.mockResolvedValue({});
});

describe("ChannelGateForm", () => {
  it("has a single amount field, in USD", () => {
    render(<ChannelGateForm channelId={ID} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText(FIELD)).toBeInTheDocument();
    expect(screen.queryByLabelText(/DAO/)).toBeNull();
  });

  it("starts from the current gate", () => {
    render(<ChannelGateForm channelId={ID} gate={{ minDonatedUsd6: "12500000", scope: "post" }} />);
    expect(screen.getByLabelText(FIELD)).toHaveValue("12,5");
    expect(screen.getByRole("radio", { name: "Escribir" })).toBeChecked();
  });

  it("submits minDonatedUsd as typed and the scope", async () => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText(FIELD), "12,5");
    await user.click(screen.getByRole("radio", { name: "Escribir" }));
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    await waitFor(() => expect(setChannelGateAction).toHaveBeenCalledWith({ id: ID, minDonatedUsd: "12,5", scope: "post" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("empty clears the gate", async () => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} gate={{ minDonatedUsd6: "10000000", scope: "view" }} />);
    await user.clear(screen.getByLabelText(FIELD));
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    await waitFor(() => expect(setChannelGateAction).toHaveBeenCalledWith({ id: ID, minDonatedUsd: null, scope: "view" }));
  });

  it.each(["-1", "1,234", "abc", "1,"])("rejects %s without calling the action", async (bad) => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText(FIELD), bad);
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    expect(screen.getByLabelText(FIELD)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("hasta 2 decimales");
    expect(setChannelGateAction).not.toHaveBeenCalled();
  });

  it("accepts 0 as a minimum", async () => {
    const user = userEvent.setup();
    render(<ChannelGateForm channelId={ID} />);
    await user.type(screen.getByLabelText(FIELD), "0");
    await user.click(screen.getByRole("button", { name: "Guardar candado" }));
    await waitFor(() => expect(setChannelGateAction).toHaveBeenCalledWith({ id: ID, minDonatedUsd: "0", scope: "view" }));
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
