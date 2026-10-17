import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.hoisted(() => vi.fn(async (): Promise<{ error?: string }> => ({})));
vi.mock("@/lib/notifications/actions", () => ({ setChannelFollowAction: set }));

import { FollowMenu } from "@/components/notifications/follow-menu";

const CH = "11111111-1111-4111-8111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("FollowMenu", () => {
  it("reflects the effective level in the trigger", () => {
    render(<FollowMenu channelId={CH} level="mentions" />);
    expect(screen.getByRole("button", { name: /Avisos del canal: solo menciones/i })).toBeInTheDocument();
  });

  it("shows an error state instead of a default when the level could not be loaded", () => {
    render(<FollowMenu channelId={CH} level={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/No se pudo cargar/i);
    expect(screen.queryByRole("button", { name: /Avisos del canal/i })).toBeNull();
  });

  it("marks the current level in the menu and calls the action on change", async () => {
    render(<FollowMenu channelId={CH} level="mentions" />);
    await userEvent.click(screen.getByRole("button", { name: /Avisos del canal/i }));
    expect(screen.getByRole("menuitemradio", { name: "Solo menciones" })).toBeChecked();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Todos los mensajes" }));
    expect(set).toHaveBeenCalledWith(CH, "all");
    await waitFor(() => expect(screen.getByRole("button", { name: /todos los mensajes/i })).toBeInTheDocument());
  });

  it("rolls back and shows the error when the action fails", async () => {
    set.mockResolvedValueOnce({ error: "forbidden" });
    render(<FollowMenu channelId={CH} level="all" />);
    await userEvent.click(screen.getByRole("button", { name: /Avisos del canal/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Silenciar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permiso/i);
    expect(screen.getByRole("button", { name: /todos los mensajes/i })).toBeInTheDocument();
  });
});
