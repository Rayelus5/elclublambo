import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((e: { id: string; threadRootId: string | null; events: string[] }) => void),
  onResync: null as null | (() => void),
  composer: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/chat/realtime", () => ({
  useChannelEvents: (_id: string, cb: typeof h.onEvent, opts?: { onResync?: () => void }) => {
    h.onEvent = cb;
    h.onResync = opts?.onResync ?? null;
  },
}));
vi.mock("@/lib/chat/unread", () => ({ useUnread: () => ({ unread: new Set<string>(), refresh: vi.fn() }) }));
vi.mock("@/components/chat/composer", () => ({
  Composer: (props: Record<string, unknown>) => {
    h.composer.push(props);
    return <div role="textbox" aria-label="Mensaje" />;
  },
}));

const actions = vi.hoisted(() => ({
  postMessageAction: vi.fn(),
  toggleReactionAction: vi.fn(),
  editMessageAction: vi.fn(),
  deleteMessageAction: vi.fn(),
  setPinnedAction: vi.fn(),
}));
vi.mock("@/lib/chat/actions", () => ({ ...actions, searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })) }));

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
import type { OutgoingMessage } from "@/lib/chat/pending";
import { emptyDirectory } from "@/lib/chat/model";
import { CHANNEL, directory, doc, makeMessage, ME, OTHER, viewer } from "./fixtures";

const none = emptyDirectory();
const history = () => [makeMessage({ body: doc("historia") })];

function setup(props: Partial<ChatViewProps> = {}) {
  return render(
    <ChatView
      channel={{ id: CHANNEL, slowmodeSeconds: 0 }}
      viewer={viewer()}
      allowedDomains={[]}
      initial={{ messages: history(), hasMore: false, directory, pinned: [], lastReadAt: null }}
      {...props}
    />,
  );
}

const outgoing = (text = "hola"): OutgoingMessage => ({ doc: doc(text), expanded: false, quotedId: null, attachments: [] });
const composer = () => h.composer.at(-1)!;
const handOver = (text = "hola") => (composer().onSendOptimistic as (m: OutgoingMessage) => Promise<unknown>)(outgoing(text));
async function send(text = "hola") {
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = handOver(text);
  });
  return result;
}
const row = (text: string) => screen.getByText(text).closest("li")!;
const rows = (text: string) => screen.queryAllByText(text).map((t) => t.closest("li"));
const keyOf = (call: number) => (actions.postMessageAction.mock.calls[call]![0] as { clientId: string }).clientId;
const liveRegion = () => document.querySelector('[aria-live="polite"]')!;
const echo = async (m: ReturnType<typeof makeMessage>) => {
  queries.getMessage.mockResolvedValue({ message: m, messages: [m], directory });
  await act(async () => h.onEvent!({ id: m.id, threadRootId: null, events: ["message_created"] }));
};

beforeEach(() => {
  h.composer.length = 0;
  Object.values(actions).forEach((f) => f.mockReset());
  Object.values(queries).forEach((f) => f.mockReset());
  queries.markChannelRead.mockResolvedValue({});
  queries.getPinned.mockResolvedValue({ messages: [], directory: none });
  queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
});

describe("ChatView: optimistic send", () => {
  it("shows the message at once as «Enviando…» and swaps in the confirmed one in the same row", async () => {
    let answer: (v: object) => void = () => {};
    actions.postMessageAction.mockReturnValue(new Promise((r) => (answer = r)));
    setup();
    act(() => {
      void handOver("hola");
    });
    const pendingRow = row("hola");
    expect(pendingRow).toHaveTextContent("Enviando…");
    expect(actions.postMessageAction).toHaveBeenCalledWith({
      channelId: CHANNEL,
      doc: doc("hola"),
      expanded: false,
      quotedId: null,
      attachments: [],
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    const real = makeMessage({ authorId: ME, body: doc("hola"), clientId: keyOf(0) });
    queries.getMessage.mockResolvedValue({ message: real, messages: [real], directory });
    await act(async () => answer({ id: real.id }));
    await waitFor(() => expect(row("hola")).not.toHaveTextContent("Enviando…"));
    expect(row("hola")).toBe(pendingRow);
    expect(row("hola")).toHaveAttribute("data-message-id", real.id);
    expect(rows("hola")).toHaveLength(1);
  });

  it("the channel composer only sends optimistically outside an anchored view", () => {
    setup();
    expect(composer().onSendOptimistic).toBeTypeOf("function");
    h.composer.length = 0;
    setup({ initial: { messages: history(), hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null } });
    expect(composer().onSendOptimistic).toBeUndefined();
  });

  it("«Reintentar» resends with the same key, whatever the failure (the server deduplicates it)", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);

    const real = makeMessage({ authorId: ME, body: doc("hola") });
    actions.postMessageAction.mockResolvedValueOnce({ id: real.id });
    queries.getMessage.mockResolvedValue({ message: { ...real, clientId: keyOf(0) }, messages: [], directory });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(row("hola")).toHaveAttribute("data-message-id", real.id));
    expect(actions.postMessageAction).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(queries.getMessages).not.toHaveBeenCalled();
    expect(rows("hola")).toHaveLength(1);
  });

  it("a failed message that arrives by realtime with its key is adopted, not duplicated", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    await echo(makeMessage({ authorId: ME, body: doc("hola"), clientId: keyOf(0) }));
    await waitFor(() => expect(screen.queryByText(/No se ha enviado/)).not.toBeInTheDocument());
    expect(rows("hola")).toHaveLength(1);
  });

  it("never adopts a message by its text: the same text from another tab stays separate", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    await echo(makeMessage({ authorId: ME, body: doc("hola"), clientId: "99999999-9999-4999-8999-999999999999" }));
    await waitFor(() => expect(rows("hola")).toHaveLength(2));
    expect(screen.getByText(/No se ha enviado/)).toBeInTheDocument();
  });

  it("a message the server refused is never adopted", async () => {
    actions.postMessageAction.mockResolvedValueOnce({ error: "rate_limited" });
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado\. Has hecho demasiadas acciones/);
    await echo(makeMessage({ authorId: ME, body: doc("hola"), clientId: keyOf(0) }));
    await waitFor(() => expect(rows("hola")).toHaveLength(2));
    expect(screen.getByText(/No se ha enviado/)).toBeInTheDocument();
  });

  it("does not announce a failure once the message was adopted", async () => {
    let fail: (e: Error) => void = () => {};
    actions.postMessageAction.mockReturnValue(new Promise((_r, j) => (fail = j)));
    setup();
    act(() => {
      void handOver("hola");
    });
    await echo(makeMessage({ authorId: ME, body: doc("hola"), clientId: keyOf(0) }));
    await act(async () => fail(new Error("network")));
    expect(screen.queryByText(/No se ha enviado/)).not.toBeInTheDocument();
    expect(liveRegion()).not.toHaveTextContent("No se ha podido enviar");
  });

  it("announces every failure, also a repeated one", async () => {
    actions.postMessageAction.mockRejectedValue(new Error("network"));
    setup();
    await send("hola");
    await waitFor(() => expect(liveRegion()).toHaveTextContent("No se ha podido enviar el mensaje"));
    let release: () => void = () => {};
    actions.postMessageAction.mockReturnValueOnce(new Promise((_r, j) => (release = () => j(new Error("network")))));
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    // The region is emptied while it retries, so the same words are read again.
    expect(liveRegion()).toHaveTextContent("");
    await act(async () => release());
    await waitFor(() => expect(liveRegion()).toHaveTextContent("No se ha podido enviar el mensaje"));
  });

  it("a resync that brings the failed message adopts it", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    const landed = makeMessage({ authorId: ME, body: doc("hola"), clientId: keyOf(0) });
    queries.getMessages.mockResolvedValue({ messages: [...history(), landed], hasMore: false, directory: none });
    await act(async () => h.onResync!());
    await waitFor(() => expect(screen.queryByText(/No se ha enviado/)).not.toBeInTheDocument());
    expect(rows("hola")).toHaveLength(1);
  });

  it("messages missed while disconnected and brought by a resync do not animate", async () => {
    setup();
    const missed = makeMessage({ authorId: OTHER, body: doc("perdido") });
    queries.getMessages.mockResolvedValue({ messages: [...history(), missed], hasMore: false, directory: none });
    await act(async () => h.onResync!());
    expect(await screen.findByText("perdido")).toBeInTheDocument();
    expect(row("perdido")).not.toHaveClass("animate-message-in");
  });

  it("«Descartar» removes the failed message", async () => {
    actions.postMessageAction.mockResolvedValueOnce({ error: "forbidden" });
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByText("hola")).not.toBeInTheDocument();
  });

  it("hands the server answer back to the composer (slowmode countdown)", async () => {
    actions.postMessageAction.mockResolvedValueOnce({ error: "slowmode", slowmodeSeconds: 9 });
    setup();
    expect(await send("hola")).toEqual({ error: "slowmode", slowmodeSeconds: 9 });
  });
});
