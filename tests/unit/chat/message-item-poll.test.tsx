import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/lib/bounties/actions", () => ({ cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(async () => ({ ok: true, status: "changed", voterCount: 1 })) }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));

import { MessageItem, type MessageItemProps } from "@/components/chat/message-item";
import type { PollDetail } from "@/lib/polls/polls";
import { directory, doc, makeMessage, ME, viewer } from "./fixtures";

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

function setup(props: Partial<MessageItemProps>) {
  const message = props.message ?? makeMessage();
  render(
    <ol>
      <MessageItem message={message} directory={directory} allowedDomains={[]} viewer={viewer()} onEdit={vi.fn()} onDelete={vi.fn()} {...props} />
    </ol>,
  );
  return message;
}

describe("MessageItem: poll message", () => {
  it("renders the question and the poll card under it", () => {
    setup({ message: makeMessage({ kind: "poll", authorId: ME, body: doc("¿Subimos el límite?"), poll: poll() }) });
    const q = screen.getByText("¿Subimos el límite?");
    const group = screen.getByRole("radiogroup", { name: "Opciones" });
    expect(q.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers no Editar on the author's own poll, but keeps Borrar", async () => {
    setup({ message: makeMessage({ kind: "poll", authorId: ME, poll: poll() }) });
    await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Borrar" })).toBeInTheDocument();
  });

  it("renders the pinned variant read-only", () => {
    setup({ message: makeMessage({ kind: "poll", authorId: ME, poll: poll() }), variant: "pinned" });
    expect(screen.getByText("Encuesta")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("renders the plain question when the poll could not be read", () => {
    setup({ message: makeMessage({ kind: "poll", authorId: ME, body: doc("sin detalles"), poll: null }) });
    expect(screen.getByText("sin detalles")).toBeInTheDocument();
    expect(screen.queryByText("Encuesta")).not.toBeInTheDocument();
  });

  it("reports a change of the poll to the list", async () => {
    const onPollChanged = vi.fn();
    const message = setup({
      message: makeMessage({ kind: "poll", authorId: ME, poll: poll({ myOptionId: A, iVoted: true }) }),
      onPollChanged,
    });
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Cambiar voto" }));
    expect(onPollChanged).toHaveBeenCalledWith(message);
  });
});
