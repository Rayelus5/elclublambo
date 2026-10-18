import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));

import { MessageList, type MessageListProps } from "@/components/chat/message-list";
import { directory, makeMessage, ME, OTHER, viewer } from "./fixtures";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 17, 10, minutes, 0)).toISOString();

function setup(props: Partial<MessageListProps> = {}) {
  const onLoadMore = vi.fn();
  const utils = render(
    <MessageList
      messages={[]}
      directory={directory}
      allowedDomains={[]}
      viewer={viewer()}
      lastReadAt={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={onLoadMore}
      {...props}
    />,
  );
  return { onLoadMore, ...utils };
}

describe("MessageList", () => {
  it("groups consecutive messages of the same author under five minutes", () => {
    setup({
      messages: [
        makeMessage({ authorId: OTHER, createdAt: at(0) }),
        makeMessage({ authorId: OTHER, createdAt: at(2) }),
        makeMessage({ authorId: OTHER, createdAt: at(4) }),
        makeMessage({ authorId: ME, createdAt: at(5) }),
        makeMessage({ authorId: OTHER, createdAt: at(6) }),
        makeMessage({ authorId: OTHER, createdAt: at(30) }),
      ],
    });
    // Ana: first of the run, again after Yo Mismo, and again after a 24 min gap -> 3 headers
    expect(screen.getAllByText("Ana")).toHaveLength(3);
    expect(screen.getAllByText("Yo Mismo")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("shows the 'Nuevos' separator before the first unread message of someone else", () => {
    setup({
      lastReadAt: at(1),
      messages: [
        makeMessage({ authorId: OTHER, createdAt: at(0), body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "leído" }] }] } }),
        makeMessage({ authorId: ME, createdAt: at(2) }),
        makeMessage({ authorId: OTHER, createdAt: at(3), body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "sin leer" }] }] } }),
      ],
    });
    const separator = screen.getByRole("separator", { name: "Nuevos mensajes" });
    expect(separator).toHaveTextContent("Nuevos");
    const items = screen.getAllByRole("listitem").filter((li) => li.getAttribute("role") !== "separator");
    const order = Array.from(document.querySelectorAll("ol > li")).map((li) => (li === separator ? "sep" : li.textContent));
    expect(order.indexOf("sep")).toBe(2);
    expect(within(items.at(-1)!).getByText("sin leer")).toBeInTheDocument();
  });

  it("has no separator without a read mark or when everything is read", () => {
    setup({ messages: [makeMessage({ createdAt: at(0) })], lastReadAt: null });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("has no separator when everything is read", () => {
    setup({ messages: [makeMessage({ createdAt: at(0) })], lastReadAt: at(10) });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("offers to load older messages and reports the click", async () => {
    const { onLoadMore } = setup({ hasMore: true, messages: [makeMessage()] });
    await userEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("disables the load button while loading", () => {
    setup({ hasMore: true, loadingMore: true, messages: [makeMessage()] });
    const button = screen.getByRole("button", { name: /Cargando/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("hides the load button when there is nothing older", () => {
    setup({ hasMore: false, messages: [makeMessage()] });
    expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument();
  });

  it("shows an empty state", () => {
    setup();
    expect(screen.getByText("Todavía no hay mensajes. Sé el primero en escribir.")).toBeInTheDocument();
  });

  it("the empty state of a read-only member does not invite to write", () => {
    setup({ viewer: viewer({ canPost: false }) });
    expect(screen.getByText("Todavía no hay mensajes.")).toBeInTheDocument();
  });

  it("is a named log region", () => {
    setup({ messages: [makeMessage()] });
    expect(screen.getByRole("log", { name: "Mensajes del canal" })).toBeInTheDocument();
  });
});
