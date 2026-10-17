import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  post: vi.fn(async (): Promise<{ id?: string; error?: string }> => ({ id: "m-new" })),
  setStatus: vi.fn(async (): Promise<{ error?: string }> => ({})),
  getMessage: vi.fn(),
  getState: vi.fn(),
  getMessages: vi.fn(),
  handlers: {} as { onMessage?: (id: string) => void; onUpdated?: () => void; onResync?: () => void },
  refresh: vi.fn(),
}));

vi.mock("@/lib/tickets/actions", () => ({ postTicketMessageAction: h.post, setTicketStatusAction: h.setStatus }));
vi.mock("@/lib/tickets/queries", () => ({ getTicketMessage: h.getMessage, getTicketMessages: h.getMessages, getTicketState: h.getState }));
vi.mock("@/lib/tickets/realtime", () => ({
  useTicketEvents: (_id: string, handlers: typeof h.handlers) => {
    h.handlers = handlers;
  },
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));

import { TicketView, type TicketViewProps } from "@/components/tickets/ticket-view";

const T = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "m1",
  authorId: "author",
  authorName: "Ana",
  isStaff: false,
  bodyText: "no puedo entrar",
  allowLinks: false,
  createdAt: "2026-10-17T10:00:00+00:00",
};

function setup(over: Partial<TicketViewProps> = {}) {
  const props: TicketViewProps = {
    ticket: { id: T, subject: "No puedo entrar", status: "open", channelName: "soporte", authorId: "author" },
    initialMessages: [base, { ...base, id: "m2", authorId: "staff1", authorName: "Bruno", isStaff: true, bodyText: "mira https://x.example" }],
    viewer: { isStaff: false },
    allowedDomains: [],
    ...over,
  };
  render(<TicketView {...props} />);
}

beforeEach(() => {
  h.post.mockReset().mockResolvedValue({ id: "m-new" });
  h.setStatus.mockReset().mockResolvedValue({});
  h.getMessage.mockReset();
  h.getState.mockReset();
  h.getMessages.mockReset();
  h.refresh.mockReset();
  h.handlers = {};
});

describe("TicketView", () => {
  it("shows the subject, the messages in order and the Staff label only on staff messages", () => {
    setup();
    expect(screen.getByRole("heading", { name: "No puedo entrar" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("no puedo entrar");
    expect(items[1]).toHaveTextContent("Bruno");
    expect(items[1]).toHaveTextContent("Staff");
    expect(items[0]).not.toHaveTextContent("Staff");
  });

  it("links of an author without allow_links render as text", () => {
    setup();
    expect(screen.queryByRole("link", { name: /x\.example/ })).toBeNull();
    expect(screen.getByText(/https:\/\/x\.example/)).toBeInTheDocument();
  });

  it("a closed ticket shows the banner and disables the composer", () => {
    setup({ ticket: { id: T, subject: "S", status: "closed", channelName: "soporte", authorId: "author" } });
    expect(screen.getByText("Ticket cerrado")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Escribe tu respuesta/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
  });

  it("the author sees Cerrar on an open ticket and never Reabrir on a closed one", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Cerrar ticket" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reabrir ticket" })).toBeNull();
  });

  it("the author does not get Reabrir when the ticket is closed", () => {
    setup({ ticket: { id: T, subject: "S", status: "closed", channelName: "soporte", authorId: "author" } });
    expect(screen.queryByRole("button", { name: "Reabrir ticket" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar ticket" })).toBeNull();
  });

  it("staff can reopen a closed ticket", async () => {
    setup({
      ticket: { id: T, subject: "S", status: "closed", channelName: "soporte", authorId: "author" },
      viewer: { isStaff: true },
    });
    await userEvent.click(screen.getByRole("button", { name: "Reabrir ticket" }));
    expect(h.setStatus).toHaveBeenCalledWith(T, "open");
  });

  it("closing asks for confirmation first, explaining that only staff can reopen", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar ticket" }));
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Solo el equipo puede reabrirlo");
    await userEvent.click(screen.getByRole("button", { name: "Sí, cerrar" }));
    expect(h.setStatus).toHaveBeenCalledWith(T, "closed");
  });

  it("cancelling the confirmation does not close", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar ticket" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("keeps focus on the textarea while sending (not disabled) and ignores a second Enter", async () => {
    let finish!: () => void;
    h.post.mockImplementation(() => new Promise((r) => (finish = () => r({ id: "m-new" }))));
    h.getMessage.mockResolvedValue({ ...base, id: "m-new", bodyText: "hola" });
    setup();
    const box = screen.getByLabelText(/Escribe tu respuesta/) as HTMLTextAreaElement;
    await userEvent.type(box, "hola{Enter}");
    expect(box).not.toBeDisabled();
    expect(box).toHaveFocus();
    await userEvent.type(box, "{Enter}");
    expect(h.post).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(box).toHaveFocus();
  });

  it("a ticket_closed error refreshes the status and keeps the draft visible", async () => {
    h.post.mockResolvedValue({ error: "ticket_closed" });
    h.getState.mockResolvedValue({ status: "closed" });
    setup();
    await userEvent.type(screen.getByLabelText(/Escribe tu respuesta/), "mi borrador{Enter}");
    expect(await screen.findByText("Ticket cerrado")).toBeInTheDocument();
    const draft = screen.getByLabelText(/borrador/i) as HTMLTextAreaElement;
    expect(draft.value).toBe("mi borrador");
    expect(draft).toHaveAttribute("readonly");
  });

  it("a realtime close keeps the unsent draft", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/Escribe tu respuesta/), "a medias");
    h.getState.mockResolvedValue({ status: "closed" });
    await act(async () => {
      h.handlers.onUpdated?.();
    });
    expect(await screen.findByText("Ticket cerrado")).toBeInTheDocument();
    expect((screen.getByLabelText(/borrador/i) as HTMLTextAreaElement).value).toBe("a medias");
  });

  it("resync fetches the missing messages in one query and keeps them sorted by date", async () => {
    setup();
    const older = { ...base, id: "m0", bodyText: "intermedio", createdAt: "2026-10-17T10:00:30+00:00" };
    const newest = { ...base, id: "m9", bodyText: "al final", createdAt: "2026-10-17T11:00:00+00:00" };
    h.getState.mockResolvedValue({ status: "open" });
    h.getMessages.mockResolvedValue([newest, base, older]);
    await act(async () => {
      h.handlers.onResync?.();
    });
    await screen.findByText("al final");
    expect(h.getMessages).toHaveBeenCalledTimes(1);
    expect(h.getMessage).not.toHaveBeenCalled();
    const texts = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(texts.findIndex((x) => x.includes("intermedio"))).toBeLessThan(texts.findIndex((x) => x.includes("al final")));
  });

  it("Enter sends, Shift+Enter adds a new line, the counter counts", async () => {
    setup();
    const box = screen.getByLabelText(/Escribe tu respuesta/) as HTMLTextAreaElement;
    h.getMessage.mockResolvedValue({ ...base, id: "m-new", bodyText: "hola\nmundo" });
    await userEvent.type(box, "hola{Shift>}{Enter}{/Shift}mundo");
    expect(box.value).toBe("hola\nmundo");
    expect(screen.getByText("10/4000")).toBeInTheDocument();
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(T, "hola\nmundo"));
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("does not send an empty message", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/Escribe tu respuesta/), "   {Enter}");
    expect(h.post).not.toHaveBeenCalled();
  });

  it("shows the server error and keeps the draft", async () => {
    h.post.mockResolvedValue({ error: "ticket_closed" });
    h.getState.mockResolvedValue({ status: "open" });
    setup();
    const box = screen.getByLabelText(/Escribe tu respuesta/) as HTMLTextAreaElement;
    await userEvent.type(box, "hola{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("cerrado");
    expect(box.value).toBe("hola");
  });

  it("a realtime event adds the message after re-reading it, once", async () => {
    setup();
    h.getMessage.mockResolvedValue({ ...base, id: "m3", authorId: "staff1", authorName: "Bruno", isStaff: true, bodyText: "te ayudo" });
    await act(async () => {
      h.handlers.onMessage?.("m3");
      h.handlers.onMessage?.("m3");
    });
    expect(await screen.findByText("te ayudo")).toBeInTheDocument();
    expect(screen.getAllByText("te ayudo")).toHaveLength(1);
    expect(h.getMessage).toHaveBeenCalledWith(expect.anything(), "m3");
  });

  it("a ticket_updated event re-reads the status and disables the composer when it closed", async () => {
    setup();
    h.getState.mockResolvedValue({ status: "closed" });
    await act(async () => {
      h.handlers.onUpdated?.();
    });
    expect(await screen.findByText("Ticket cerrado")).toBeInTheDocument();
  });
  it("after the author confirms Cerrar, focus moves to the Ticket cerrado banner (not body)", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar ticket" }));
    await userEvent.click(screen.getByRole("button", { name: "Sí, cerrar" }));
    const banner = await screen.findByText("Ticket cerrado");
    await waitFor(() => expect(banner.closest("[role='status']")).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it("after staff closes, focus goes to Reabrir ticket; after reopening, back to Cerrar ticket", async () => {
    setup({ viewer: { isStaff: true } });
    await userEvent.click(screen.getByRole("button", { name: "Cerrar ticket" }));
    await userEvent.click(screen.getByRole("button", { name: "Sí, cerrar" }));
    const reopen = await screen.findByRole("button", { name: "Reabrir ticket" });
    await waitFor(() => expect(reopen).toHaveFocus());
    await userEvent.click(reopen);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar ticket" })).toHaveFocus());
  });

  it("a realtime close does not steal focus from the composer", async () => {
    setup();
    const box = screen.getByLabelText(/Escribe tu respuesta/);
    await userEvent.type(box, "a medias");
    h.getState.mockResolvedValue({ status: "closed" });
    await act(async () => {
      h.handlers.onUpdated?.();
    });
    await screen.findByText("Ticket cerrado");
    // The component moved nothing: focus is where the user left it (the editable box is swapped for a read-only draft
    // when the ticket closes, so it may fall back to body), never on the banner or on a button.
    const active = document.activeElement;
    expect(active).toBe(box.isConnected ? box : document.body);
    expect(active?.closest("[role='status']")).toBeNull();
    expect(active?.tagName).not.toBe("BUTTON");
  });
});
