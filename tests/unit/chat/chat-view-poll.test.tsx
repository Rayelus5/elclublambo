import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((e: { id: string; threadRootId: string | null; events: string[] }) => void),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/lib/bounties/actions", () => ({ cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/chat/realtime", () => ({
  useChannelEvents: (_id: string, cb: typeof h.onEvent) => {
    h.onEvent = cb;
  },
}));
vi.mock("@/lib/chat/unread", () => ({ useUnread: () => ({ unread: new Set<string>(), refresh: h.refresh }) }));
vi.mock("@/components/chat/composer", () => ({ Composer: () => <div role="textbox" aria-label="Mensaje" tabIndex={0} /> }));

const actions = vi.hoisted(() => ({
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

import { ChatView } from "@/components/chat/chat-view";
import { emptyDirectory } from "@/lib/chat/model";
import type { PollDetail } from "@/lib/polls/polls";
import { CHANNEL, directory, doc, makeMessage, ME, viewer } from "./fixtures";

const none = emptyDirectory();
const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";

const poll = (over: Partial<PollDetail> = {}): PollDetail => ({
  messageId: "p1",
  weightMode: "equal",
  closesAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  closed: false,
  voterCount: 1,
  options: [
    { id: A, label: "Sí", position: 0 },
    { id: B, label: "No", position: 1 },
  ],
  myOptionId: null,
  iVoted: false,
  myHasWeight: null,
  results: { status: "pending" },
  ...over,
});

beforeEach(() => {
  h.refresh.mockReset();
  Object.values(actions).forEach((f) => f.mockReset());
  Object.values(queries).forEach((f) => f.mockReset());
  queries.markChannelRead.mockResolvedValue({});
  queries.getPinned.mockResolvedValue({ messages: [], directory: none });
  queries.getMessage.mockResolvedValue({ message: null, messages: [], directory: none });
});

describe("ChatView: polls", () => {
  it("a poll_changed event re-reads the poll and the new voter count shows without a reload", async () => {
    const root = makeMessage({ kind: "poll", authorId: ME, body: doc("¿Sí o no?"), poll: poll() });
    render(
      <ChatView
        channel={{ id: CHANNEL, slowmodeSeconds: 0 }}
        viewer={viewer()}
        allowedDomains={[]}
        initial={{ messages: [root], hasMore: false, directory, pinned: [], lastReadAt: null }}
      />,
    );
    expect(screen.getByText("1 votante")).toBeInTheDocument();
    const updated = { ...root, poll: poll({ voterCount: 2 }) };
    queries.getMessage.mockResolvedValue({ message: updated, messages: [updated], directory });
    await act(async () => {
      h.onEvent!({ id: root.id, threadRootId: null, events: ["poll_changed"] });
    });
    await waitFor(() => expect(queries.getMessage).toHaveBeenCalledWith(expect.anything(), root.id, ME));
    await waitFor(() => expect(screen.getByText("2 votantes")).toBeInTheDocument());
  });
});
