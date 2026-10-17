import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import type { NotificationView } from "@/lib/notifications/queries";

const view = (over: Partial<NotificationView>): NotificationView => ({
  id: 1,
  kind: "mention",
  createdAt: "2026-10-17T10:00:00Z",
  readAt: "2026-10-17T10:05:00Z",
  actor: { name: "Ana", wallet: "0xabc" },
  channelName: "trading",
  excerpt: null,
  ticketSubject: null,
  ticketStatus: null,
  href: "/c/x",
  ...over,
});

const text = (v: NotificationView) => {
  const { container, unmount } = render(<NotificationItem notification={v} />);
  const out = container.querySelector("a")!.textContent;
  unmount();
  return out;
};

describe("NotificationItem", () => {
  it.each([
    [{ kind: "mention" }, "Ana te mencionó en #trading"],
    [{ kind: "reply" }, "Ana respondió en un hilo de #trading"],
    [{ kind: "channel_message" }, "Ana escribió en #trading"],
    [{ kind: "invite_redeemed" }, "Ana canjeó tu invitación"],
    [{ kind: "godchild_banned" }, "Han baneado a tu ahijado Ana"],
    [{ kind: "sponsor_penalized" }, "Has perdido el permiso de invitar porque baneamos a Ana"],
    [{ kind: "report_new" }, "Nuevo reporte en #trading"],
    [{ kind: "member_review" }, "Ana está marcado para revisar"],
    [{ kind: "ticket_new", ticketSubject: "Ayuda" }, "Nuevo ticket: Ayuda"],
    [{ kind: "ticket_reply", ticketSubject: "Ayuda" }, "Respuesta en tu ticket Ayuda"],
    [{ kind: "ticket_status", ticketSubject: "Ayuda", ticketStatus: "closed" }, "Ticket Ayuda cerrado"],
    [{ kind: "ticket_status", ticketSubject: "Ayuda", ticketStatus: "open" }, "Ticket Ayuda reabierto"],
  ] as const)("copy for %o", (over, expected) => {
    expect(text(view(over as Partial<NotificationView>))).toContain(expected);
  });

  it("falls back to Alguien without an actor", () => {
    expect(text(view({ actor: null }))).toContain("Alguien te mencionó en #trading");
  });

  it("links to href and shows the excerpt", () => {
    render(<NotificationItem notification={view({ excerpt: "hola", href: "/c/x?thread=y" })} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/c/x?thread=y");
    expect(screen.getByText("hola")).toBeInTheDocument();
  });

  it("marks unread items with an accessible label", () => {
    render(<NotificationItem notification={view({ readAt: null })} />);
    expect(screen.getByLabelText(/sin leer/i)).toBeInTheDocument();
  });

  it("read items have no unread mark", () => {
    render(<NotificationItem notification={view({})} />);
    expect(screen.queryByLabelText(/sin leer/i)).toBeNull();
  });
});
