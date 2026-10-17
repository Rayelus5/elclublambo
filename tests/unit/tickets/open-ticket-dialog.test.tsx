import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  open: vi.fn(async (): Promise<{ id?: string; error?: string }> => ({ id: "t-1" })),
  push: vi.fn(),
}));
vi.mock("@/lib/tickets/actions", () => ({ openTicketAction: h.open }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));

import { OpenTicketDialog } from "@/components/tickets/open-ticket-dialog";

const CH = "11111111-1111-4111-8111-111111111111";

async function openDialog() {
  render(<OpenTicketDialog channelId={CH} channelName="soporte" />);
  await userEvent.click(screen.getByRole("button", { name: "Abrir ticket" }));
}

beforeEach(() => {
  h.open.mockReset().mockResolvedValue({ id: "t-1" });
  h.push.mockReset();
});

describe("OpenTicketDialog", () => {
  it("opens with a labelled subject and message, privately explained", async () => {
    await openDialog();
    expect(screen.getByRole("dialog", { name: "Abrir un ticket" })).toBeInTheDocument();
    expect(screen.getByLabelText("Asunto")).toBeInTheDocument();
    expect(screen.getByLabelText(/Mensaje/)).toBeInTheDocument();
    expect(screen.getByText(/Solo lo verás tú y el equipo/)).toBeInTheDocument();
  });

  it("validates the subject (3 to 120) and the message before calling the action", async () => {
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Enviar ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("asunto");
    await userEvent.type(screen.getByLabelText("Asunto"), "Ayuda");
    await userEvent.click(screen.getByRole("button", { name: "Enviar ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("mensaje");
    expect(h.open).not.toHaveBeenCalled();
  });

  it("sends and navigates to the new ticket", async () => {
    await openDialog();
    await userEvent.type(screen.getByLabelText("Asunto"), "Ayuda");
    await userEvent.type(screen.getByLabelText(/Mensaje/), "no puedo entrar");
    await userEvent.click(screen.getByRole("button", { name: "Enviar ticket" }));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith(CH, "Ayuda", "no puedo entrar"));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/tickets/t-1"));
  });

  it("shows the limit error in Spanish", async () => {
    h.open.mockResolvedValue({ error: "too_many_open_tickets" });
    await openDialog();
    await userEvent.type(screen.getByLabelText("Asunto"), "Ayuda");
    await userEvent.type(screen.getByLabelText(/Mensaje/), "hola");
    await userEvent.click(screen.getByRole("button", { name: "Enviar ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("3 tickets abiertos");
    expect(h.push).not.toHaveBeenCalled();
  });
});
