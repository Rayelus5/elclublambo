import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((e: { id: string; threadRootId: string | null; events: string[] }) => void),
  composer: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/chat/realtime", () => ({
  useChannelEvents: (_id: string, cb: typeof h.onEvent) => {
    h.onEvent = cb;
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
  markReadAction: vi.fn(),
}));
vi.mock("@/lib/chat/actions", () => ({ ...actions, searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })) }));

const queries = vi.hoisted(() => ({
  getMessage: vi.fn(),
  getMessages: vi.fn(),
  getMessagesByIds: vi.fn(),
  getThread: vi.fn(),
  getPinned: vi.fn(),
}));
vi.mock("@/lib/chat/queries", () => queries);

import { ChatView, type ChatViewProps } from "@/components/chat/chat-view";
import type { OutgoingMessage } from "@/lib/chat/pending";
import { emptyDirectory } from "@/lib/chat/model";
import { CHANNEL, directory, doc, makeMessage, ME, viewer } from "./fixtures";

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

const outgoing = (text = "hola"): OutgoingMessage => ({ doc: doc(text), text, expanded: false, quotedId: null, attachments: [] });
const composer = () => h.composer.at(-1)!;
async function send(text = "hola") {
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = (composer().onSendOptimistic as (m: OutgoingMessage) => Promise<unknown>)(outgoing(text));
  });
  return result;
}
const row = (text: string) => screen.getByText(text).closest("li")!;

beforeEach(() => {
  h.composer.length = 0;
  Object.values(actions).forEach((f) => f.mockReset());
  Object.values(queries).forEach((f) => f.mockReset());
  actions.markReadAction.mockResolvedValue({});
  queries.getPinned.mockResolvedValue({ messages: [], directory: none });
  queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
});

describe("ChatView: optimistic send", () => {
  it("shows the message at once as «Enviando…» and swaps in the confirmed one in the same row", async () => {
    let answer: (v: object) => void = () => {};
    actions.postMessageAction.mockReturnValue(new Promise((r) => (answer = r)));
    setup();
    act(() => {
      void (composer().onSendOptimistic as (m: OutgoingMessage) => Promise<unknown>)(outgoing("hola"));
    });
    const pendingRow = row("hola");
    expect(pendingRow).toHaveTextContent("Enviando…");
    expect(actions.postMessageAction).toHaveBeenCalledWith({ channelId: CHANNEL, doc: doc("hola"), expanded: false, quotedId: null, attachments: [] });

    const real = makeMessage({ authorId: ME, body: doc("hola") });
    queries.getMessage.mockResolvedValue({ message: real, messages: [real], directory });
    await act(async () => answer({ id: real.id }));
    await waitFor(() => expect(row("hola")).not.toHaveTextContent("Enviando…"));
    expect(row("hola")).toBe(pendingRow);
    expect(row("hola")).toHaveAttribute("data-message-id", real.id);
    expect(screen.getAllByText("hola")).toHaveLength(1);
  });

  it("the channel composer only sends optimistically outside an anchored view", () => {
    setup();
    expect(composer().onSendOptimistic).toBeTypeOf("function");
    h.composer.length = 0;
    setup({ initial: { messages: history(), hasMore: false, hasNewer: true, directory, pinned: [], lastReadAt: null } });
    expect(composer().onSendOptimistic).toBeUndefined();
  });

  it("a refused send is marked and «Reintentar» simply resends (nothing was written)", async () => {
    actions.postMessageAction.mockResolvedValueOnce({ error: "rate_limited" });
    setup();
    await send("hola");
    expect(await screen.findByText(/No se ha enviado\. Has hecho demasiadas acciones/)).toBeInTheDocument();

    const real = makeMessage({ authorId: ME, body: doc("hola") });
    actions.postMessageAction.mockResolvedValueOnce({ id: real.id });
    queries.getMessage.mockResolvedValue({ message: real, messages: [real], directory });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(row("hola")).toHaveAttribute("data-message-id", real.id));
    expect(actions.postMessageAction).toHaveBeenCalledTimes(2);
    expect(queries.getMessages).not.toHaveBeenCalled();
  });

  it("after a broken call, «Reintentar» first looks for the message and does not post it twice", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);

    const landed = makeMessage({ authorId: ME, body: doc("hola") });
    queries.getMessages.mockResolvedValue({ messages: [...history(), landed], hasMore: false, directory: none });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(row("hola")).toHaveAttribute("data-message-id", landed.id));
    expect(actions.postMessageAction).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("hola")).toHaveLength(1);
  });

  it("after a broken call, it resends when the message is not there", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    queries.getMessages.mockResolvedValue({ messages: history(), hasMore: false, directory: none });
    actions.postMessageAction.mockResolvedValueOnce({ id: "99999999-9999-4999-8999-999999999999" });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(actions.postMessageAction).toHaveBeenCalledTimes(2));
  });

  it("never resends blindly: if the check itself fails, it stays failed", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    queries.getMessages.mockRejectedValue(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText(/No se ha enviado/);
    expect(actions.postMessageAction).toHaveBeenCalledTimes(1);
  });

  it("a failed message that arrives by realtime after all is adopted, not duplicated", async () => {
    actions.postMessageAction.mockRejectedValueOnce(new Error("network"));
    setup();
    await send("hola");
    await screen.findByText(/No se ha enviado/);
    const landed = makeMessage({ authorId: ME, body: doc("hola") });
    queries.getMessage.mockResolvedValue({ message: landed, messages: [landed], directory });
    await act(async () => h.onEvent!({ id: landed.id, threadRootId: null, events: ["message_created"] }));
    await waitFor(() => expect(screen.queryByText(/No se ha enviado/)).not.toBeInTheDocument());
    expect(screen.getAllByText("hola")).toHaveLength(1);
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
