import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((e: { id: string; threadRootId: string | null; events: string[] }) => void),
  onResync: null as null | (() => void),
  refresh: vi.fn(),
  replace: vi.fn(),
  composer: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));
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
}));
vi.mock("@/lib/chat/actions", () => ({
  ...actions,
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));

const queries = vi.hoisted(() => ({
  getMessage: vi.fn(),
  getMessages: vi.fn(),
  getMessagesByIds: vi.fn(),
  getThread: vi.fn(),
  getPinned: vi.fn(),
  markChannelRead: vi.fn(),
}));
vi.mock("@/lib/chat/queries", () => queries);

import { ChatView, type ChatViewProps } from "@/components/chat/chat-view";
import { emptyDirectory, type ChatMessage } from "@/lib/chat/model";
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
  h.replace.mockReset();
  Object.values(actions).forEach((f) => f.mockReset());
  Object.values(queries).forEach((f) => f.mockReset());
  queries.markChannelRead.mockResolvedValue({});
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
    await waitFor(() => expect(queries.markChannelRead).toHaveBeenCalledWith(expect.anything(), CHANNEL));
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

    it("opens the thread named by initialThreadId (a notification link) even when the root is not in the window", async () => {
      const r = root();
      const reply = makeMessage({ threadRootId: r.id, createdAt: at(2), body: doc("la respuesta") });
      queries.getThread.mockResolvedValue({ root: r, replies: [reply], directory: none });
      setup({ initialThreadId: r.id }, []);
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      expect(await within(panel).findByText("la respuesta")).toBeInTheDocument();
      expect(queries.getThread).toHaveBeenCalledWith(expect.anything(), r.id, ME);
    });

    it("closing a thread opened from ?thread removes the param from the URL without navigating away", async () => {
      const r = root();
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({ initialThreadId: r.id }, []);
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      expect(h.replace).not.toHaveBeenCalled();
      await userEvent.click(within(panel).getByRole("button", { name: "Cerrar hilo" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());
      expect(h.replace).toHaveBeenCalledTimes(1);
      expect(h.replace).toHaveBeenCalledWith(`/foro/c/${CHANNEL}`, { scroll: false });
    });

    it("closing a thread opened from the list does not touch the URL", async () => {
      const r = root();
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({}, [r]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      await userEvent.click(within(panel).getByRole("button", { name: "Cerrar hilo" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());
      expect(h.replace).not.toHaveBeenCalled();
    });

    it("drops the thread when the linked root is gone, not in this channel, or unreadable", async () => {
      queries.getThread.mockResolvedValue({ root: null, replies: [], directory: none });
      setup({ initialThreadId: "00000000-0000-4000-8000-0000000000aa" }, []);
      await waitFor(() => expect(queries.getThread).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());

      const foreign = makeMessage({ channelId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
      queries.getThread.mockResolvedValue({ root: foreign, replies: [], directory: none });
      setup({ initialThreadId: foreign.id }, []);
      await waitFor(() => expect(queries.getThread).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());
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

  describe("polish", () => {
    it("throttles mark-read: a burst of events costs one call", async () => {
      setup();
      await waitFor(() => expect(queries.markChannelRead).toHaveBeenCalledTimes(1));
      queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
      await emit("11111111-1111-4111-8111-111111111111");
      await emit("22222222-2222-4222-8222-222222222222");
      await emit("33333333-3333-4333-8333-333333333333");
      expect(queries.markChannelRead).toHaveBeenCalledTimes(1);
    });

    it("resync drops messages that were hard-deleted while away", async () => {
      const { messages } = setup();
      queries.getMessages.mockResolvedValue({ messages: [messages[1]!], hasMore: false, directory });
      await act(async () => h.onResync?.());
      await waitFor(() => expect(screen.queryByText("primero")).not.toBeInTheDocument());
      expect(screen.getByText("segundo")).toBeInTheDocument();
    });

    it("opening another thread moves focus to the new panel", async () => {
      const r1 = makeMessage({ createdAt: at(1), body: doc("raíz uno"), replyCount: 1 });
      const r2 = makeMessage({ createdAt: at(2), body: doc("raíz dos"), replyCount: 2 });
      queries.getThread.mockImplementation(async (_s: unknown, id: string) => ({ root: id === r1.id ? r1 : r2, replies: [], directory: none }));
      setup({}, [r1, r2]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      const first = await screen.findByRole("dialog", { name: "Hilo" });
      await waitFor(() => expect(within(first).getByRole("heading", { name: "Hilo" })).toHaveFocus());
      // the dialog is modal: switch through the store of openers by closing and opening the other thread
      await userEvent.click(within(first).getByRole("button", { name: "Cerrar hilo" }));
      await userEvent.click(screen.getByRole("button", { name: "2 respuestas" }));
      const second = await screen.findByRole("dialog", { name: "Hilo" });
      await waitFor(() => expect(within(second).getByRole("heading", { name: "Hilo" })).toHaveFocus());
      expect(within(second).getByText("raíz dos")).toBeInTheDocument();
    });

    it("lands on the message list when the open thread's root disappears", async () => {
      const r = makeMessage({ createdAt: at(1), body: doc("raíz"), replyCount: 1 });
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({}, [r]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      await screen.findByRole("dialog", { name: "Hilo" });
      queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
      await emit(r.id, ["message_deleted"]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Hilo" })).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole("log", { name: "Mensajes del canal" })).toHaveFocus());
    });

    it("Escape during an inline edit in the mobile thread dialog cancels the edit, not the dialog", async () => {
      const r = makeMessage({ createdAt: at(1), body: doc("raíz"), replyCount: 1 });
      const mine = makeMessage({ threadRootId: r.id, authorId: ME, createdAt: at(2), body: doc("mi respuesta") });
      queries.getThread.mockResolvedValue({ root: r, replies: [mine], directory });
      setup({}, [r]);
      await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
      const dialog = await screen.findByRole("dialog", { name: "Hilo" });
      const reply = await within(dialog).findByText("mi respuesta");
      const item = reply.closest("li")!;
      await userEvent.click(within(item).getByRole("button", { name: "Acciones del mensaje" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));
      const box = await within(dialog).findByRole("textbox", { name: "Editar mensaje" });
      await waitFor(() => expect(box).toHaveFocus());
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(within(dialog).queryByRole("textbox", { name: "Editar mensaje" })).not.toBeInTheDocument());
      expect(screen.getByRole("dialog", { name: "Hilo" })).toBeInTheDocument();
    });

    it("keeps the announcer outside the inert column while a thread covers the list (1024-1279)", async () => {
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => ({
        matches: q.includes("1024"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      try {
        const r = makeMessage({ createdAt: at(1), body: doc("raíz"), replyCount: 1 });
        queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
        const { container } = setup({}, [r]);
        await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
        await screen.findByRole("complementary", { name: "Panel del hilo" });
        expect(container.querySelector("[inert]")).not.toBeNull();
        const live = container.querySelector('[aria-live="polite"]');
        expect(live).not.toBeNull();
        expect(live!.closest("[inert]")).toBeNull();
      } finally {
        window.matchMedia = original;
      }
    });
  });

  describe("jump to a message (?m=)", () => {
    const scrolls: Array<{ id: string | null; arg: unknown }> = [];
    const original = Element.prototype.scrollIntoView;
    beforeEach(() => {
      scrolls.length = 0;
      Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
        scrolls.push({ id: this.getAttribute("data-message-id"), arg });
      };
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });
    const anchored = () => {
      const msgs = [makeMessage({ createdAt: at(1), body: doc("uno") }), makeMessage({ createdAt: at(2), body: doc("objetivo") }), makeMessage({ createdAt: at(3), body: doc("tres") })];
      return msgs;
    };
    const item = (id: string) => document.getElementById(`msg-${id}`)!;

    it("scrolls the anchor to the centre, highlights it with aria-current for exactly two seconds and announces it", () => {
      vi.useFakeTimers();
      try {
        const msgs = anchored();
        setup({ initialAnchorId: msgs[1]!.id, initial: { messages: msgs, hasMore: true, hasNewer: true, directory, pinned: [], lastReadAt: null } }, msgs);
        expect(item(msgs[1]!.id)).toHaveAttribute("aria-current", "true");
        expect(item(msgs[0]!.id)).not.toHaveAttribute("aria-current");
        expect(scrolls.find((s) => s.id === msgs[1]!.id)?.arg).toMatchObject({ block: "center", behavior: "smooth" });
        expect(screen.getByText("Mostrando el mensaje seleccionado")).toBeInTheDocument();
        act(() => void vi.advanceTimersByTime(1900));
        expect(item(msgs[1]!.id)).toHaveAttribute("aria-current", "true");
        act(() => void vi.advanceTimersByTime(200));
        expect(item(msgs[1]!.id)).not.toHaveAttribute("aria-current");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not animate the scroll under prefers-reduced-motion", () => {
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
      try {
        const msgs = anchored();
        setup({ initialAnchorId: msgs[1]!.id }, msgs);
        expect(scrolls.find((s) => s.id === msgs[1]!.id)?.arg).toMatchObject({ block: "center", behavior: "auto" });
      } finally {
        window.matchMedia = original;
      }
    });

    it("a normal view highlights nothing and offers no 'Ir a lo más reciente'", () => {
      const msgs = anchored();
      setup({}, msgs);
      expect(document.querySelector('[aria-current="true"]')).toBeNull();
      expect(screen.queryByRole("button", { name: "Ir a lo más reciente" })).not.toBeInTheDocument();
    });

    it("'Ir a lo más reciente' drops ?m from the URL", async () => {
      const msgs = anchored();
      setup({ initialAnchorId: msgs[1]!.id, initial: { messages: msgs, hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null } }, msgs);
      await userEvent.click(screen.getByRole("button", { name: "Ir a lo más reciente" }));
      expect(h.replace).toHaveBeenCalledWith(`/foro/c/${CHANNEL}`, { scroll: false });
    });

    it("keeps loading older messages from the anchored view", async () => {
      const msgs = anchored();
      const older = makeMessage({ createdAt: at(0), body: doc("anterior") });
      setup({ initialAnchorId: msgs[1]!.id, initial: { messages: msgs, hasMore: true, hasNewer: true, directory, pinned: [], lastReadAt: null } }, msgs);
      queries.getMessages.mockResolvedValue({ messages: [older], hasMore: false, directory: none });
      await userEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
      expect(await screen.findByText("anterior")).toBeInTheDocument();
      expect(queries.getMessages.mock.calls[0]![3].before).toEqual({ createdAt: msgs[0]!.createdAt, id: msgs[0]!.id });
    });

    it("does not append realtime messages out of order while newer pages exist, and says so", async () => {
      const msgs = anchored();
      setup({ initialAnchorId: msgs[1]!.id, initial: { messages: msgs, hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null } }, msgs);
      const incoming = makeMessage({ createdAt: at(40), body: doc("llegó al final") });
      queries.getMessage.mockResolvedValue({ message: incoming, messages: [incoming], directory });
      await emit(incoming.id, ["message_created"]);
      expect(screen.queryByText("llegó al final")).not.toBeInTheDocument();
      expect(await screen.findByText("Hay mensajes nuevos")).toBeInTheDocument();
    });

    it("still applies edits to messages inside the anchored window", async () => {
      const msgs = anchored();
      setup({ initialAnchorId: msgs[1]!.id, initial: { messages: msgs, hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null } }, msgs);
      const edited = { ...msgs[2]!, body: doc("tres editado") };
      queries.getMessage.mockResolvedValue({ message: edited, messages: [edited], directory });
      await emit(edited.id);
      expect(await screen.findByText("tres editado")).toBeInTheDocument();
    });

    it("does not mark the channel read while newer messages remain unseen", async () => {
      const msgs = anchored();
      setup({ initialAnchorId: msgs[1]!.id, initial: { messages: msgs, hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null } }, msgs);
      await emit("11111111-1111-4111-8111-111111111111");
      expect(queries.markChannelRead).not.toHaveBeenCalled();
    });

    const anchoredProps = (msgs: ChatMessage[]) => ({
      initialAnchorId: msgs[1]!.id,
      initial: { messages: msgs, hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null },
    });

    it("only a created root beyond the window raises 'Hay mensajes nuevos' and the announcement", async () => {
      const msgs = anchored();
      setup(anchoredProps(msgs), msgs);
      const incoming = makeMessage({ createdAt: at(40), body: doc("llegó al final") });
      queries.getMessage.mockResolvedValue({ message: incoming, messages: [incoming], directory });
      await emit(incoming.id, ["message_updated", "reaction_added"]);
      await emit(incoming.id, ["message_pinned"]);
      expect(screen.queryByText("Hay mensajes nuevos")).not.toBeInTheDocument();
      expect(screen.queryByText(/Mensaje nuevo de/)).not.toBeInTheDocument();
      await emit(incoming.id, ["message_created"]);
      expect(await screen.findByText("Hay mensajes nuevos")).toBeInTheDocument();
      expect(screen.getByText(/Mensaje nuevo de/)).toBeInTheDocument();
    });

    it("a reply-driven reconcile of a root beyond the window is not news", async () => {
      const msgs = anchored();
      setup(anchoredProps(msgs), msgs);
      const far = makeMessage({ createdAt: at(40), body: doc("raíz lejana"), replyCount: 1 });
      queries.getMessage.mockImplementation(async (_s: unknown, id: string) =>
        id === far.id ? { message: far, messages: [far], directory } : { message: null, messages: [], directory: none },
      );
      await emit("99999999-9999-4999-8999-999999999999", ["message_created"], far.id);
      await waitFor(() => expect(queries.getMessage).toHaveBeenCalledWith(expect.anything(), far.id, ME));
      expect(screen.queryByText("Hay mensajes nuevos")).not.toBeInTheDocument();
    });

    it("resync in an anchored view re-reads the loaded window by id: applies edits, drops deletions, appends nothing", async () => {
      const msgs = anchored();
      setup(anchoredProps(msgs), msgs);
      const edited = { ...msgs[0]!, body: doc("uno editado") };
      queries.getMessagesByIds.mockResolvedValue({ messages: [edited, msgs[1]!], directory });
      await act(async () => h.onResync?.());
      expect(await screen.findByText("uno editado")).toBeInTheDocument();
      expect(screen.queryByText("tres")).not.toBeInTheDocument();
      expect(queries.getMessagesByIds.mock.calls[0]![1]).toEqual(msgs.map((m) => m.id));
      expect(queries.getMessages).not.toHaveBeenCalled();
      expect(screen.queryByText("Hay mensajes nuevos")).not.toBeInTheDocument();
    });

    it("posting from an anchored view goes to the latest window", () => {
      const msgs = anchored();
      setup(anchoredProps(msgs), msgs);
      const onPosted = h.composer.at(-1)!.onPosted as (id: string) => void;
      act(() => onPosted("11111111-1111-4111-8111-111111111111"));
      expect(h.replace).toHaveBeenCalledWith(`/foro/c/${CHANNEL}`, { scroll: false });
    });

    it("shows an inline error with a retry when 'Ir a lo más reciente' never completes", () => {
      vi.useFakeTimers();
      try {
        const msgs = anchored();
        setup(anchoredProps(msgs), msgs);
        fireEvent.click(screen.getByRole("button", { name: "Ir a lo más reciente" }));
        expect(screen.getByRole("button", { name: "Ir a lo más reciente" })).toBeDisabled();
        act(() => void vi.advanceTimersByTime(8100));
        expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar lo más reciente");
        const retry = screen.getByRole("button", { name: "Reintentar" });
        expect(retry).toBeEnabled();
        fireEvent.click(retry);
        expect(h.replace).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps ?m and the nonce when closing the thread of a root anchor", async () => {
      const r = makeMessage({ createdAt: at(1), body: doc("raíz"), replyCount: 1 });
      queries.getThread.mockResolvedValue({ root: r, replies: [], directory: none });
      setup({ initialThreadId: r.id, initialAnchorId: r.id, initialAnchorNonce: "n1" }, [r]);
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      await userEvent.click(within(panel).getByRole("button", { name: "Cerrar hilo" }));
      expect(h.replace).toHaveBeenCalledWith(`/foro/c/${CHANNEL}?m=${r.id}&h=n1`, { scroll: false });
    });

    it("a reply anchor opens its thread and highlights the reply there", async () => {
      const r = makeMessage({ createdAt: at(1), body: doc("raíz"), replyCount: 2 });
      const a = makeMessage({ threadRootId: r.id, createdAt: at(2), body: doc("otra respuesta") });
      const target = makeMessage({ threadRootId: r.id, createdAt: at(3), body: doc("la respuesta buscada") });
      queries.getThread.mockResolvedValue({ root: r, replies: [a, target], directory: none });
      setup({ initialThreadId: r.id, initialAnchorId: target.id }, [r]);
      const panel = await screen.findByRole("dialog", { name: "Hilo" });
      const hit = (await within(panel).findByText("la respuesta buscada")).closest("li")!;
      expect(hit).toHaveAttribute("aria-current", "true");
      expect(within(panel).getByText("otra respuesta").closest("li")).not.toHaveAttribute("aria-current");
      await waitFor(() => expect(scrolls.some((s) => s.id === target.id)).toBe(true));
      // the main list shows the root, not the bottom of the window
      expect(scrolls.some((s) => s.id === r.id)).toBe(true);
      // closing the thread drops the reply anchor but keeps the reading position at the thread root
      await userEvent.click(within(panel).getByRole("button", { name: "Cerrar hilo" }));
      expect(h.replace).toHaveBeenCalledWith(`/foro/c/${CHANNEL}?m=${r.id}`, { scroll: false });
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
