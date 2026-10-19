import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/lib/bounties/actions", () => ({ cancelBountyAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));

import { MessageItem, type MessageItemProps } from "@/components/chat/message-item";
import type { BountyDetail } from "@/lib/bounties/queries";
import { directory, doc, makeMessage, ME, OTHER, viewer } from "./fixtures";

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

function setup(props: Partial<MessageItemProps>) {
  const message = props.message ?? makeMessage();
  render(
    <ol>
      <MessageItem message={message} directory={directory} allowedDomains={[]} viewer={viewer()} {...props} />
    </ol>,
  );
  return message;
}

describe("MessageItem: bounty message", () => {
  it("renders the bounty card above the description", () => {
    setup({ message: makeMessage({ kind: "bounty", authorId: ME, body: doc("Se busca un bug"), bounty: bounty() }) });
    expect(screen.getByTestId("bounty-status")).toHaveTextContent("Abierto");
    expect(screen.getByText("25 USDC")).toBeInTheDocument();
    expect(screen.getByText("Se busca un bug")).toBeInTheDocument();
  });

  it("gives the author Cancelar bounty but not other members", () => {
    setup({ message: makeMessage({ kind: "bounty", authorId: ME, bounty: bounty() }) });
    expect(screen.getByRole("button", { name: "Cancelar bounty" })).toBeInTheDocument();
  });

  it("does not give other members author actions", () => {
    setup({ message: makeMessage({ kind: "bounty", authorId: OTHER, bounty: bounty() }) });
    expect(screen.queryByRole("button", { name: "Cancelar bounty" })).not.toBeInTheDocument();
  });

  it("still renders the text when the bounty details could not be read", () => {
    setup({ message: makeMessage({ kind: "bounty", authorId: OTHER, body: doc("sin detalles"), bounty: null }) });
    expect(screen.getByText("sin detalles")).toBeInTheDocument();
    expect(screen.queryByTestId("bounty-status")).not.toBeInTheDocument();
  });

  it("reports a change of the bounty to the list", async () => {
    const onBountyChanged = vi.fn();
    const { cancelBountyAction } = await import("@/lib/bounties/actions");
    vi.mocked(cancelBountyAction).mockResolvedValue({ ok: true });
    const message = setup({ message: makeMessage({ kind: "bounty", authorId: ME, bounty: bounty() }), onBountyChanged });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar bounty" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sí, cancelar bounty" }));
    await waitFor(() => expect(onBountyChanged).toHaveBeenCalledWith(message));
  });
});

describe("MessageItem: Marcar como solución", () => {
  const reply = (over = {}) => makeMessage({ threadRootId: "root", authorId: OTHER, ...over });

  it("is offered on another member's reply when the handler is present", async () => {
    const onMarkSolution = vi.fn(async () => null);
    const message = setup({ message: reply(), variant: "thread", onMarkSolution });
    await userEvent.click(screen.getByRole("button", { name: "Marcar como solución" }));
    expect(onMarkSolution).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Sí, marcar como solución" }));
    await waitFor(() => expect(onMarkSolution).toHaveBeenCalledWith(message));
  });

  it("shows the server error and keeps the confirmation open when marking is refused", async () => {
    const onMarkSolution = vi.fn(async () => "Esa respuesta no puede ser la solución.");
    setup({ message: reply(), variant: "thread", onMarkSolution });
    await userEvent.click(screen.getByRole("button", { name: "Marcar como solución" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sí, marcar como solución" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esa respuesta no puede ser la solución.");
  });

  it("is absent without the handler (not the author, or not an open bounty)", () => {
    setup({ message: reply(), variant: "thread" });
    expect(screen.queryByRole("button", { name: "Marcar como solución" })).not.toBeInTheDocument();
  });

  it("is absent on the author's own reply, a deleted reply and a system notice", () => {
    const onMarkSolution = vi.fn(async () => null);
    for (const message of [reply({ authorId: ME }), reply({ deletedAt: "2026-10-18T10:00:00Z" }), reply({ kind: "system", authorId: null })]) {
      const { unmount } = render(
        <ol>
          <MessageItem message={message} directory={directory} allowedDomains={[]} viewer={viewer()} variant="thread" onMarkSolution={onMarkSolution} />
        </ol>,
      );
      expect(screen.queryByRole("button", { name: "Marcar como solución" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("flags the reply that is the solution", () => {
    setup({ message: reply(), variant: "thread", isSolution: true });
    expect(screen.getByText("Solución")).toBeInTheDocument();
  });
});
