import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));

import { MessageList, type MessageListProps, type PendingView } from "@/components/chat/message-list";
import type { ChatMessage } from "@/lib/chat/model";
import { directory, doc, makeMessage, ME, OTHER, viewer } from "./fixtures";

const ENTER = "animate-message-in";

function props(over: Partial<MessageListProps> = {}): MessageListProps {
  return {
    messages: [],
    directory,
    allowedDomains: [],
    viewer: viewer(),
    lastReadAt: null,
    hasMore: false,
    loadingMore: false,
    onLoadMore: vi.fn(),
    ...over,
  };
}

const row = (text: string) => screen.getByText(text).closest("li")!;

/** jsdom has no layout: give the scroller a size and put the reader `fromBottom` px above the end. */
function scrollTo(fromBottom: number) {
  const el = screen.getByRole("log");
  Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
  el.scrollTop = 2000 - 400 - fromBottom;
  fireEvent.scroll(el);
  return el;
}

describe("MessageList: day separators", () => {
  it("separates days with Hoy / Ayer in the viewer's time zone", () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 1);
    render(
      <MessageList
        {...props({
          messages: [makeMessage({ createdAt: yesterday.toISOString(), body: doc("ayer") }), makeMessage({ createdAt: today.toISOString(), body: doc("hoy") })],
        })}
      />,
    );
    const seps = screen.getAllByRole("separator");
    expect(seps.map((s) => s.getAttribute("aria-label"))).toEqual(["Ayer", "Hoy"]);
    expect(seps[0]).toHaveTextContent("Ayer");
  });
});

describe("MessageList: entry animation", () => {
  it("animates only messages that arrive after mount, never the history", () => {
    const a = makeMessage({ body: doc("uno") });
    const b = makeMessage({ body: doc("dos") });
    const { rerender } = render(<MessageList {...props({ messages: [a, b] })} />);
    expect(row("uno")).not.toHaveClass(ENTER);
    expect(row("dos")).not.toHaveClass(ENTER);

    const c = makeMessage({ body: doc("tres") });
    rerender(<MessageList {...props({ messages: [a, b, c] })} />);
    expect(row("tres")).toHaveClass(ENTER);
    expect(row("dos")).not.toHaveClass(ENTER);
  });

  it("does not animate a re-render of a loaded message (edit, reaction, resync)", () => {
    const a = makeMessage({ body: doc("uno") });
    const { rerender } = render(<MessageList {...props({ messages: [a] })} />);
    rerender(<MessageList {...props({ messages: [{ ...a, body: doc("uno editado"), editedAt: a.createdAt }] })} />);
    expect(row("uno editado")).not.toHaveClass(ENTER);
  });

  it("does not animate an older page loaded with «Cargar anteriores»", () => {
    const old = makeMessage({ body: doc("antiguo"), createdAt: "2026-01-01T10:00:00.000Z" });
    const a = makeMessage({ body: doc("uno") });
    const { rerender } = render(<MessageList {...props({ messages: [a], hasMore: true })} />);
    rerender(<MessageList {...props({ messages: [old, a], hasMore: false })} />);
    expect(row("antiguo")).not.toHaveClass(ENTER);
  });

  it("drops the class once the animation ends", () => {
    const a = makeMessage({ body: doc("uno") });
    const { rerender } = render(<MessageList {...props({ messages: [a] })} />);
    const b = makeMessage({ body: doc("dos") });
    rerender(<MessageList {...props({ messages: [a, b] })} />);
    // React listens to the prefixed name when jsdom lacks the CSS animation properties: send both.
    act(() => {
      row("dos").dispatchEvent(new Event("animationend", { bubbles: true }));
      row("dos").dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
    });
    expect(row("dos")).not.toHaveClass(ENTER);
  });
});

describe("MessageList: new messages pill", () => {
  it("follows new messages at the bottom without a pill", () => {
    const a = makeMessage();
    const { rerender } = render(<MessageList {...props({ messages: [a] })} />);
    rerender(<MessageList {...props({ messages: [a, makeMessage()] })} />);
    expect(screen.queryByRole("button", { name: /mensajes? nuevos?/ })).not.toBeInTheDocument();
  });

  it("counts what arrives while the reader is scrolled up, and takes them to the end", async () => {
    const a = makeMessage();
    const { rerender } = render(<MessageList {...props({ messages: [a] })} />);
    const el = scrollTo(600);
    const b = makeMessage({ authorId: OTHER });
    rerender(<MessageList {...props({ messages: [a, b] })} />);
    expect(screen.getByRole("button", { name: "1 mensaje nuevo" })).toBeInTheDocument();
    // The reader stays where they were.
    expect(el.scrollTop).toBe(1000);

    rerender(<MessageList {...props({ messages: [a, b, makeMessage({ authorId: OTHER })] })} />);
    await userEvent.click(screen.getByRole("button", { name: "2 mensajes nuevos" }));
    expect(el.scrollTop).toBe(2000);
    expect(screen.queryByRole("button", { name: /mensajes nuevos/ })).not.toBeInTheDocument();
  });

  it("goes away when the reader scrolls back to the end", () => {
    const a = makeMessage();
    const { rerender } = render(<MessageList {...props({ messages: [a] })} />);
    scrollTo(600);
    rerender(<MessageList {...props({ messages: [a, makeMessage({ authorId: OTHER })] })} />);
    scrollTo(0);
    expect(screen.queryByRole("button", { name: /mensaje nuevo/ })).not.toBeInTheDocument();
  });
});

describe("MessageList: pending messages", () => {
  const pendingMsg = (over: Partial<ChatMessage> = {}) => makeMessage({ id: "p-1", authorId: ME, body: doc("pendiente"), ...over });
  const view = (over: Partial<PendingView> = {}): PendingView => ({ message: pendingMsg(), status: "sending", onRetry: vi.fn(), onDiscard: vi.fn(), ...over });

  it("shows a discreet «Enviando…» state, without actions or reactions", () => {
    render(<MessageList {...props({ messages: [makeMessage()], pending: [view()] })} />);
    const li = row("pendiente");
    expect(li).toHaveTextContent("Enviando…");
    expect(li).toHaveAttribute("aria-busy", "true");
    expect(li.querySelector('[aria-label="Acciones del mensaje"]')).toBeNull();
  });

  it("marks a failed send and offers to retry or discard", async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    render(<MessageList {...props({ pending: [view({ status: "failed", error: "Vas demasiado rápido.", onRetry, onDiscard })] })} />);
    expect(row("pendiente")).toHaveTextContent("No se ha enviado. Vas demasiado rápido.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("the confirmed message takes over the pending row (same element: no second animation)", () => {
    const a = makeMessage();
    const { rerender } = render(<MessageList {...props({ messages: [a], pending: [view()] })} />);
    const before = row("pendiente");
    expect(before).toHaveClass(ENTER);
    const real = makeMessage({ authorId: ME, body: doc("pendiente") });
    rerender(<MessageList {...props({ messages: [a, real], pending: [], rowKeys: { [real.id]: "p-1" } })} />);
    expect(row("pendiente")).toBe(before);
    expect(row("pendiente")).not.toHaveTextContent("Enviando…");
  });
});
