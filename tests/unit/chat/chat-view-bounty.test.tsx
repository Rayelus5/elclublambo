import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((e: { id: string; threadRootId: string | null; events: string[] }) => void),
  onResync: null as null | (() => void),
  refresh: vi.fn(),
  replace: vi.fn(),
  composer: [] as Array<Record<string, unknown>>,
  mark: vi.fn(),
}));

vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock("@/lib/bounties/actions", () => ({ markSolutionAction: (...a: unknown[]) => h.mark(...a), cancelBountyAction: vi.fn() }));
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
  getMessagesByIds: vi.fn(),
  getThread: vi.fn(),
  getPinned: vi.fn(),
}));
vi.mock("@/lib/chat/queries", () => queries);

import { ChatView, type ChatViewProps } from "@/components/chat/chat-view";
import type { BountyDetail } from "@/lib/bounties/queries";
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
  actions.markReadAction.mockResolvedValue({});
  actions.toggleReactionAction.mockResolvedValue({ active: true });
  actions.setPinnedAction.mockResolvedValue({});
  actions.deleteMessageAction.mockResolvedValue({});
  actions.editMessageAction.mockResolvedValue({});
  queries.getPinned.mockResolvedValue({ messages: [], directory: none });
  queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
});



const bounty = (over: Partial<BountyDetail> = {}): BountyDetail => ({
  messageId: "root",
  token: "USDC",
  amount: 25_000_000n,
  chainId: 59141,
  status: "open",
  solutionMessageId: null,
  solverId: null,
  solutionMarkedAt: null,
  payDeadline: null,
  paidTipId: null,
  ...over,
});

describe("ChatView: bounties", () => {
  const root = (over: Partial<ChatMessage> = {}) =>
    makeMessage({ kind: "bounty", authorId: ME, createdAt: at(1), body: doc("Se busca ayuda"), replyCount: 1, bounty: bounty(), ...over });
  const reply = (r: ChatMessage) => makeMessage({ threadRootId: r.id, authorId: OTHER, createdAt: at(2), body: doc("mi solución") });

  it("tells the composer whether /bounty is available (CREATE_BOUNTIES with SEND_MESSAGES)", () => {
    setup({ viewer: viewer({ canBounty: true }) });
    expect(h.composer.at(-1)).toMatchObject({ canBounty: true });
    h.composer.length = 0;
    setup({ viewer: viewer({ canBounty: false }) });
    expect(h.composer.at(-1)).toMatchObject({ canBounty: false });
  });

  it("offers /encuesta only to the root composer, and only with CREATE_POLLS and posting rights", () => {
    setup({ viewer: viewer({ canPoll: true }) });
    expect(h.composer.length).toBeGreaterThan(0);
    for (const p of h.composer) {
      expect(p.threadRootId).toBeUndefined();
      expect(p).toMatchObject({ canPoll: true });
    }
    h.composer.length = 0;
    setup({ viewer: viewer({ canPoll: false }) });
    expect(h.composer.at(-1)).toMatchObject({ canPoll: false });
  });

  it("renders the bounty card in the list", () => {
    const r = root();
    setup({}, [r]);
    expect(screen.getByTestId("bounty-status")).toHaveTextContent("Abierto");
  });

  it("lets the author mark a reply as the solution, then re-reads the bounty", async () => {
    const r = root();
    const rep = reply(r);
    queries.getThread.mockResolvedValue({ root: r, replies: [rep], directory: none });
    h.mark.mockResolvedValue({ ok: true });
    setup({}, [r]);
    await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
    const panel = await screen.findByRole("dialog", { name: "Hilo" });
    await within(panel).findByText("mi solución");
    const marked = { ...r, bounty: bounty({ status: "solution_marked", solutionMessageId: rep.id, solverId: OTHER, payDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString() }) };
    queries.getMessage.mockImplementation(async (_c: unknown, id: string) => (id === r.id ? { message: marked, messages: [marked], directory } : { message: null, messages: [], directory: none }));
    await userEvent.click(within(panel).getByRole("button", { name: "Marcar como solución" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sí, marcar como solución" }));
    await waitFor(() => expect(h.mark).toHaveBeenCalledWith(r.id, rep.id));
    await waitFor(() => expect(queries.getMessage).toHaveBeenCalledWith(expect.anything(), r.id, ME));
    await waitFor(() => expect(within(panel).getByText("Solución")).toBeInTheDocument());
    expect(within(panel).queryByRole("button", { name: "Marcar como solución" })).not.toBeInTheDocument();
  });

  it("shows the refusal and keeps the bounty untouched", async () => {
    const r = root();
    const rep = reply(r);
    queries.getThread.mockResolvedValue({ root: r, replies: [rep], directory: none });
    h.mark.mockResolvedValue({ ok: false, code: "invalid_solution", error: "Esa respuesta no puede ser la solución." });
    // Even on a refusal the bounty is re-read (it may have changed meanwhile): it is still there and still open.
    queries.getMessage.mockResolvedValue({ message: r, messages: [r], directory });
    setup({}, [r]);
    await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
    const panel = await screen.findByRole("dialog", { name: "Hilo" });
    await within(panel).findByText("mi solución");
    await userEvent.click(within(panel).getByRole("button", { name: "Marcar como solución" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sí, marcar como solución" }));
    expect(await screen.findByText("Esa respuesta no puede ser la solución.")).toBeInTheDocument();
  });

  it("offers no marking to someone who is not the author, nor once a solution exists", async () => {
    const r = root({ authorId: OTHER });
    const rep = reply(r);
    queries.getThread.mockResolvedValue({ root: r, replies: [rep], directory: none });
    setup({}, [r]);
    await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
    const panel = await screen.findByRole("dialog", { name: "Hilo" });
    await within(panel).findByText("mi solución");
    expect(within(panel).queryByRole("button", { name: "Marcar como solución" })).not.toBeInTheDocument();
  });

  it("a bounty_changed event (solution marked or cancelled by someone else) re-reads the bounty root", async () => {
    const r = root({ replyCount: 0 });
    setup({}, [r]);
    expect(screen.getByTestId("bounty-status")).toHaveTextContent("Abierto");
    const cancelled = { ...r, bounty: bounty({ status: "cancelled" }) };
    queries.getMessage.mockResolvedValue({ message: cancelled, messages: [cancelled], directory });
    await emit(r.id, ["bounty_changed"]);
    await waitFor(() => expect(queries.getMessage).toHaveBeenCalledWith(expect.anything(), r.id, ME));
    await waitFor(() => expect(screen.getByTestId("bounty-status")).toHaveTextContent("Cancelado"));
  });

  it("a payment notice in the bounty thread re-reads the bounty root", async () => {
    const r = root({ replyCount: 0 });
    setup({}, [r]);
    const paid = { ...r, bounty: bounty({ status: "paid" }) };
    queries.getMessage.mockImplementation(async (_c: unknown, id: string) => {
      if (id === r.id) return { message: paid, messages: [paid], directory };
      const notice = makeMessage({ id, kind: "system", authorId: null, threadRootId: r.id, tipId: "tip-1", createdAt: at(5) });
      return { message: notice, messages: [notice], directory };
    });
    await emit("77777777-7777-4777-8777-777777777777", ["message_created"], r.id);
    await waitFor(() => expect(screen.getByTestId("bounty-status")).toHaveTextContent("Pagado"));
  });
});
