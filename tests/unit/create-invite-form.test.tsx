import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createInviteAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/invites/actions", () => ({ createInviteAction }));

import { CreateInviteForm } from "@/components/invites/create-invite-form";

const URL_OK = "http://localhost:3000/invite/abcdefghijklmnopqrstuv";

describe("CreateInviteForm", () => {
  beforeEach(() => {
    createInviteAction.mockReset();
  });

  it("sends the chosen max_uses and expires_in", async () => {
    createInviteAction.mockResolvedValue({ url: URL_OK });
    const user = userEvent.setup();
    render(<CreateInviteForm />);

    await user.selectOptions(screen.getByLabelText("Usos"), "10");
    await user.selectOptions(screen.getByLabelText("Caduca en"), "168");
    await user.click(screen.getByRole("button", { name: "Crear invitación" }));

    await waitFor(() => expect(createInviteAction).toHaveBeenCalledTimes(1));
    const fd = createInviteAction.mock.calls[0]?.[0] as FormData;
    expect(fd.get("max_uses")).toBe("10");
    expect(fd.get("expires_in")).toBe("168");
  });

  it("shows the URL after creating and copies it to the clipboard", async () => {
    createInviteAction.mockResolvedValue({ url: URL_OK });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<CreateInviteForm />);

    await user.click(screen.getByRole("button", { name: "Crear invitación" }));
    const field = await screen.findByDisplayValue(URL_OK);
    expect(field).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: "Copiar enlace" }));
    expect(writeText).toHaveBeenCalledWith(URL_OK);
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });

  it("shows an action error with role=alert and the rpc copy", async () => {
    createInviteAction.mockResolvedValue({ error: "forbidden" });
    const user = userEvent.setup();
    render(<CreateInviteForm />);

    await user.click(screen.getByRole("button", { name: "Crear invitación" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No tienes permiso para hacer esto.");
    expect(screen.queryByRole("button", { name: "Copiar enlace" })).not.toBeInTheDocument();
  });
});
