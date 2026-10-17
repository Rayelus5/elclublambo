import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const updateChannelAction = vi.hoisted(() => vi.fn());
const deleteChannelAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/channels/actions", () => ({
  updateChannelAction,
  deleteChannelAction,
  createChannelAction: vi.fn(),
  moveChannelAction: vi.fn(),
}));

import { ChannelForm } from "@/components/settings/channel-form";
import type { ChannelDetailRow } from "@/lib/channels/tree";

const channel = (over: Partial<ChannelDetailRow> = {}): ChannelDetailRow => ({
  id: "6f1c1c5e-0000-4000-8000-000000000001",
  parentId: null,
  kind: "text",
  name: "General",
  topic: "Charla",
  position: 1,
  slowmodeSeconds: 0,
  ticketsEnabled: false,
  alphaEnabled: false,
  ...over,
});

beforeEach(() => {
  refresh.mockReset();
  updateChannelAction.mockReset();
  deleteChannelAction.mockReset();
});

describe("ChannelForm", () => {
  it("shows tickets and alpha only for text channels", () => {
    const { rerender } = render(<ChannelForm channel={channel()} />);
    expect(screen.getByLabelText("Tickets")).toBeInTheDocument();
    expect(screen.getByLabelText("Alpha")).toBeInTheDocument();
    rerender(<ChannelForm channel={channel({ kind: "forum" })} />);
    expect(screen.queryByLabelText("Tickets")).toBeNull();
    expect(screen.queryByLabelText("Alpha")).toBeNull();
  });

  it("shows an inline error for a custom slowmode out of range and does not submit", async () => {
    const user = userEvent.setup();
    render(<ChannelForm channel={channel()} />);
    await user.selectOptions(screen.getByLabelText("Slowmode"), "custom");
    const input = screen.getByLabelText("Segundos");
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("Escribe entre 5 y 604800 segundos.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(updateChannelAction).not.toHaveBeenCalled();
  });

  it("submits the chosen preset and flags", async () => {
    const user = userEvent.setup();
    updateChannelAction.mockResolvedValue({});
    render(<ChannelForm channel={channel()} />);
    await user.selectOptions(screen.getByLabelText("Slowmode"), "30");
    await user.click(screen.getByLabelText("Tickets"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(updateChannelAction).toHaveBeenCalledWith({
        id: "6f1c1c5e-0000-4000-8000-000000000001",
        name: "General",
        topic: "Charla",
        slowmodeSeconds: 30,
        ticketsEnabled: true,
        alphaEnabled: false,
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("submits a valid custom slowmode", async () => {
    const user = userEvent.setup();
    updateChannelAction.mockResolvedValue({});
    render(<ChannelForm channel={channel()} />);
    await user.selectOptions(screen.getByLabelText("Slowmode"), "custom");
    await user.type(screen.getByLabelText("Segundos"), "45");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(updateChannelAction).toHaveBeenCalledWith(expect.objectContaining({ slowmodeSeconds: 45 })),
    );
  });

  it("starts in custom mode when the stored slowmode is not a preset", () => {
    render(<ChannelForm channel={channel({ slowmodeSeconds: 45 })} />);
    expect(screen.getByLabelText("Segundos")).toHaveValue(45);
  });

  it("maps action errors with Spanish copy", async () => {
    const user = userEvent.setup();
    updateChannelAction.mockResolvedValue({ error: "forbidden" });
    render(<ChannelForm channel={channel()} />);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para hacer esto.");
  });

  it("deletes only after confirming", async () => {
    const user = userEvent.setup();
    deleteChannelAction.mockResolvedValue({});
    render(<ChannelForm channel={channel()} />);
    await user.click(screen.getByRole("button", { name: "Borrar canal" }));
    expect(deleteChannelAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(deleteChannelAction).toHaveBeenCalledWith("6f1c1c5e-0000-4000-8000-000000000001"));
  });
});
