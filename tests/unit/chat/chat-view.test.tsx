import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((e: { id: string; threadRootId: string | null; events: string[] }) => void),
  onResync: null as null | (() => void),
  refresh: vi.fn(),
  composer: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/chat/realtime", () => ({
  useChannelEvents: (_id: string, cb: typeof h.onEvent, opts?: { onResync?: () => void }) => {
    h.onEvent = cb;
    h.onResync = opts?.onResync ?? null;
  },
}));
vi.mock("@/lib/chat/unread", () => ({ useUnread: () => ({ unread: new Set<string>(), refresh: h.refresh }) }));
vi.mock("@/components/chat/composer", () => ({
  Composer: (props: Record<string, unknown>) => {
    h.composer.push(props);
    return <div role="textbox" aria-label={props.threadRootId ? "Mensaje del hilo" : "Mensaje"} tabIndex={0} />;
  },
}));

const actions = vi.hoisted(() => ({
  toggleReactionAction: vi.fn(),
  editMessageAction: vi.fn(),
  deleteMessageAction: vi.fn(),
  setPinnedAction: vi.fn(),
  markReadAction: vi.fn(),
}));
vi.mock("@/lib/chat/actions", () => ({
  ...actions,
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));

const queries = vi.hoisted(() => ({
  getMessage: vi.fn(),
  getMessages: vi.fn(),
  getThread: vi.fn(),
  getPinned: vi.fn(),
}));
vi.mock("@/lib/chat/queries", () => queries);

import { ChatView, type ChatViewProps } from "@/components/chat/chat-view";
import { emptyDirectory } from "@/lib/chat/model";
import { CHANNEL, directory, doc, makeMessage, ME, OTHER, viewer } from "./fixtures";

const none = emptyDirectory();
const at = (m: number) => new Date(Date.UTC(2026, 9, 17, 10, m, 0)).toISOString();

function setup(props: Partial<ChatViewProps> = {}, messages = [makeMessage({ createdAt: at(1), body: doc("primero") }), makeMessage({ createdAt: at(30), body: doc("segundo") })]) {
  const utils = render(
    <ChatView
      channel={{ id: CHANNEL, slowmodeSeconds: 0 }}
      viewer={viewer()}
      allowedDomains={[]}
      initial={{ messages, hasMore: false, directory, pinned: [], lastReadAt: null }}
      {...props}
    />,
  );
  return { messages, ...utils };
}

const emit = async (id: string, events = ["message_updated"], threadRootId: string | null = null) => {
  await act(async () => {
    h.onEvent!({ id, threadRootId, events });
  });
};

beforeEach(() => {
  h.composer.length = 0;
  h.refresh.mockReset();
  Object.values(actions).forEach((f) => f.mockReset());
  Object.values(queries).forEach((f) => f.mockReset());
  actions.markReadAction.mockResolvedValue({});
  actions.toggleReactionAction.mockResolvedValue({ active: true });
  actions.setPinnedAction.mockResolvedValue({});
  actions.deleteMessageAction.mockResolvedValue({});
  actions.editMessageAction.mockResolvedValue({});
  queries.getPinned.mockResolvedValue({ messages: [], directory: none });
  queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
});

describe("ChatView", () => {
  it("renders the history and the composer", () => {
    setup();
    expect(screen.getByText("primero")).toBeInTheDocument();
    expect(screen.getByText("segundo")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Mensaje" })).toBeInTheDocument();
    expect(h.composer[0]).toMatchObject({ channelId: CHANNEL, canPost: true, canAttach: true, slowmodeSeconds: 0 });
  });

  it("marks the channel as read when opened and refreshes the sidebar", async () => {
    setup();
    await waitFor(() => expect(actions.markReadAction).toHaveBeenCalledWith(CHANNEL));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("shows the read-only notice instead of the composer without SEND_MESSAGES", () => {
    setup({ viewer: viewer({ canPost: false }) });
    expect(screen.getByText("Este canal es de solo lectura.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Mensaje" })).not.toBeInTheDocument();
  });

  it("adds a message that arrives by realtime (re-read through RLS) and refreshes unread", async () => {
    setup();
    const incoming = makeMessage({ createdAt: at(40), body: doc("llegó en vivo") });
    queries.getMessage.mockResolvedValue({ message: incoming, messages: [incoming], directory });
    await emit(incoming.id, ["message_created"]);
    expect(await screen.findByText("llegó en vivo")).toBeInTheDocument();
    expect(queries.getMessage).toHaveBeenCalledWith(expect.anything(), incoming.id, ME);
    expect(h.refresh).toHaveBeenCalled();
  });

  it("removes a message the member can no longer read", async () => {
    const { messages } = setup();
    queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
    await emit(messages[0]!.id, ["message_deleted"]);
    await waitFor(() => expect(screen.queryByText("primero")).not.toBeInTheDocument());
    expect(screen.getByText("segundo")).toBeInTheDocument();
  });

  it("turns a soft-deleted message into the placeholder", async () => {
    const { messages } = setup();
    const soft = { ...messages[0]!, deletedAt: at(50), replyCount: 1 };
    queries.getMessage.mockResolvedValue({ message: soft, messages: [soft], directory: none });
    await emit(soft.id, ["message_deleted"]);
    expect(await screen.findByText("Mensaje eliminado")).toBeInTheDocument();
    expect(screen.queryByText("primero")).not.toBeInTheDocument();
  });

  it("separates the unread messages with 'Nuevos'", () => {
    setup({ initial: { messages: [makeMessage({ createdAt: at(1) }), makeMessage({ createdAt: at(30) })], hasMore: false, directory, pinned: [], lastReadAt: at(10) } });
    expect(screen.getByRole("separator", { name: "Nuevos mensajes" })).toBeInTheDocument();
  });

  it("loads older messages with the (created_at, id) cursor of the oldest one", async () => {
    const older = makeMessage({ createdAt: at(0), body: doc("antiguo") });
    const { messages } = setup({ initial: { messages: [makeMessage({ createdAt: at(1) }), makeMessage({ createdAt: at(30) })], hasMore: true, directory, pinned: [], lastReadAt: null } });
    void messages;
    queries.getMessages.mockResolvedValue({ messages: [older], hasMore: false, directory: none });
    await userEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
    expect(await screen.findByText("antiguo")).toBeInTheDocument();
    const call = queries.getMessages.mock.calls[0]!;
    expect(call[1]).toBe(CHANNEL);
    expect(call[3].before.createdAt).toBe(at(1));
    expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument();
  });

  describe("reactions", () => {
    const withReaction = () => [makeMessage({ createdAt: at(1), body: doc("con reacción"), reactions: [{ emoji: "👍", count: 1, reactedByMe: false }] })];

    it("toggles optimistically and calls the action", async () => {
      const [m] = withReaction();
      setup({}, [m!]);
      const chip = screen.getByRole("button", { name: /👍/ });
      expect(chip).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(chip);
      expect(screen.getByRole("button", { name: /👍/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /👍/ })).toHaveTextContent("2");
      expect(actions.toggleReactionAction).toHaveBeenCalledWith({ messageId: m!.id, emoji: "👍" });
      await userEvent.click(screen.getByRole("button", { name: /👍/ }));
      expect(screen.getByRole("button", { name: /👍/ })).toHaveAttribute("aria-pressed", "false");
    });

    it("reverts and explains when the server refuses", async () => {
      const [m] = withReaction();
      setup({}, [m!]);
      actions.toggleReactionAction.mockResolvedValue({ error: "forbidden" });
      queries.getMessage.mockResolvedValue({ message: m, messages: [m], directory: none });
      await userEvent.click(screen.getByRole("button", { name: /👍/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso");
      await waitFor(() => expect(screen.getByRole("button", { name: /👍/ })).toHaveAttribute("aria-pressed", "false"));
    });
  });

  describe("moderation", () => {
    it("pins from the menu", async () => {
      const { messages } = setup({ viewer: viewer({ canManage: true }) });
      const item = document.getElementById(`msg-${messages[0]!.id}`)!;
      await userEvent.click(within(item).getByRole("button", { name: "Acciones del mensaje" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Fijar" }));
      expect(actions.setPinnedAction).toHaveBeenCalledWith({ messageId: messages[0]!.id, pinned: true });
    });

    it("deletes after confirming and re-reads the message", async () => {
      const own = makeMessage({ authorId: ME, createdAt: at(1), body: doc("mío") });
      setup({}, [own]);
      await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Borrar" }));
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Borrar" }));
      await waitFor(() => expect(actions.deleteMessageAction).toHaveBeenCalledWith(own.id));
      await waitFor(() => expect(queries.getMessage).toHaveBeenCalledWith(expect.anything(), own.id, ME));
      await waitFor(() => expect(screen.queryByText("mío")).not.toBeInTheDocument());
    });

    it("shows the server error inside the confirmation when the delete fails", async () => {
      const own = makeMessage({ authorId: ME, createdAt: at(1), body: doc("mío") });
      setup({}, [own]);
      actions.deleteMessageAction.mockResolvedValue({ error: "forbidden" });
      await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Borrar" }));
      const dialog = await screen.findByRole("alertdialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("No tienes permiso");
      expect(screen.getByText("mío")).toBeInTheDocument();
    });

    it("saves an edit through the action", async () => {
      const own = makeMessage({ authorId: ME, createdAt: at(1), body: doc("mío") });
      setup({}, [own]);
      await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
      await screen.findByRole("textbox", { name: "Editar mensaje" });
      await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() => expect(actions.editMessageAction).toHaveBeenCalledTimes(1));
      expect(actions.editMessageAction.mock.calls[0]![0].id).toBe(own.id);
    });
  });

  it("quoting hands the message to the composer", async () => {
    const m = makeMessage({ createdAt: at(1), authorId: OTHER });
    setup({}, [m]);
    await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Citar" }));
    await waitFor(() => expect(h.composer.at(-1)!.quoted).toEqual({ id: m.id, authorName: "Ana" }));
  });

  describe("pinned messages", () => {
    it("has no button without pins", () => {
      setup();
      expect(screen.queryByRole("button", { name: /Fijados/ })).not.toBeInTheDocument();
    });

    it("lists them in a dialog", async () => {
      const pinned = makeMessage({ createdAt: at(1), body: doc("importante"), pinnedAt: at(2) });
      setup({ initial: { messages: [pinned], hasMore: false, directory, pinned: [pinned], lastReadAt: null } });
      await userEvent.click(screen.getByRole("button", { name: "Fijados (1)" }));
      const dialog = await screen.findByRole("dialog", { name: "Fijados (1)" });
      expect(within(dialog).getByText("importante")).toBeInTheDocument();
    });

    it("updates the count when a pin event arrives", async () => {
      const m = makeMessage({ createdAt: at(1), body: doc("nuevo fijado") });
      setup({}, [m]);
      const pinned = { ...m, pinnedAt: at(5) };
      queries.getMessage.mockResolvedValue({ message: pinned, messages: [pinned], directory: none });
      await emit(m.id, ["message_pinned"]);
      expect(await screen.findByRole("button", { name: "Fijados (1)" })).toBeInTheDocument();
    });
  });

  describe("threads", () => {
    const root = () => makeMessage({ createdAt: at(1), body: doc("raíz"), replyCount: 1 });

    it("opens the panel, loads the thread and returns focus to the opener on close", async () => {
      const r = root();
      const reply = makeMessage({ threadRootId: r.id, createdAt: at(2), body: doc("la respuesta") });
      queries.getThread.mockResolvedValue({ root: r, replies: [reply], directory: none });
      setup({}, [r]);

      const opener = screen.getByRole("button", { name: "1 respuesta" });
      await userEvent.click(opener);
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      expect(await within(panel).findByText("la respuesta")).toBeInTheDocument();
      expect(queries.getThread).toHaveBeenCalledWith(expect.anything(), r.id, ME);
      expect(h.composer.at(-1)).toMatchObject({ threadRootId: r.id });
      await waitFor(() => expect(within(panel).getByRole("heading", { name: "Hilo" })).toHaveFocus());

      await userEvent.click(within(panel).getByRole("button", { name: "Cerrar hilo" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole("button", { name: "1 respuesta" })).toHaveFocus());
    });

    it("closes with Escape", async () => {
      const r = root();
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({}, [r]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      await screen.findByRole("dialog", { name: "Hilo" });
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());
    });

    it("a reply that arrives by realtime shows up in the open thread", async () => {
      const r = root();
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({}, [r]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      const reply = makeMessage({ threadRootId: r.id, createdAt: at(3), body: doc("respuesta en vivo") });
      queries.getMessage.mockResolvedValue({ message: reply, messages: [reply], directory });
      await emit(reply.id, ["message_created"], r.id);
      expect(await within(panel).findByText("respuesta en vivo")).toBeInTheDocument();
      // replies never leak into the channel timeline
      expect(screen.getAllByText("respuesta en vivo")).toHaveLength(1);
    });

    it("opens from the menu", async () => {
      const r = makeMessage({ createdAt: at(1), body: doc("raíz") });
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({}, [r]);
      await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Responder en hilo" }));
      expect(await screen.findByRole("dialog", { name: "Hilo" })).toBeInTheDocument();
    });

    it("shows the read-only thread notice without SEND_IN_THREADS", async () => {
      const r = root();
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({ viewer: viewer({ canThread: false }) }, [r]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      expect(await screen.findByText("No puedes responder en hilos de este canal.")).toBeInTheDocument();
    });
  });

  it("re-reads the latest page after a resync", async () => {
    setup();
    const fresh = makeMessage({ createdAt: at(45), body: doc("perdido mientras estabas fuera") });
    queries.getMessages.mockResolvedValue({ messages: [fresh], hasMore: false, directory, });
    await act(async () => h.onResync?.());
    expect(await screen.findByText("perdido mientras estabas fuera")).toBeInTheDocument();
  });
});
