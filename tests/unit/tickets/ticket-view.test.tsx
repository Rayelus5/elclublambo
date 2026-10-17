import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  post: vi.fn(async (): Promise<{ id?: string; error?: string }> => ({ id: "m-new" })),
  setStatus: vi.fn(async (): Promise<{ error?: string }> => ({})),
  getMessage: vi.fn(),
  getState: vi.fn(),
  handlers: {} as { onMessage?: (id: string) => void; onUpdated?: () => void; onResync?: () => void },
  refresh: vi.fn(),
}));

vi.mock("@/lib/tickets/actions", () => ({ postTicketMessageAction: h.post, setTicketStatusAction: h.setStatus }));
vi.mock("@/lib/tickets/queries", () => ({ getTicketMessage: h.getMessage, getTicketState: h.getState }));
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
    viewer: { memberId: "author", isStaff: false },
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
      viewer: { memberId: "staff1", isStaff: true },
    });
    await userEvent.click(screen.getByRole("button", { name: "Reabrir ticket" }));
    expect(h.setStatus).toHaveBeenCalledWith(T, "open");
  });

  it("closing calls the action", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar ticket" }));
    expect(h.setStatus).toHaveBeenCalledWith(T, "closed");
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
});
