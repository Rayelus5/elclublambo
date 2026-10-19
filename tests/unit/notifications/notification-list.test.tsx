import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  markRead: vi.fn(async () => ({})),
  list: vi.fn(),
  refresh: vi.fn(),
  tick: 0,
}));
vi.mock("@/lib/notifications/actions", () => ({ markNotificationsReadAction: h.markRead }));
vi.mock("@/lib/notifications/queries", async (orig) => ({ ...(await orig<object>()), listNotifications: h.list }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/components/notifications/notifications-provider", () => ({
  useNotifications: () => ({ count: 0, eventTick: h.tick, refresh: h.refresh }),
}));

import { NotificationList } from "@/components/notifications/notification-list";
import type { NotificationView } from "@/lib/notifications/queries";

const view = (id: number, readAt: string | null = null): NotificationView => ({
  id,
  kind: "mention",
  createdAt: `2026-10-17T10:00:${String(id).padStart(2, "0")}Z`,
  readAt,
  actor: { name: `Miembro${id}`, wallet: "0xabc" },
  channelName: "general",
  excerpt: null,
  ticketSubject: null,
  ticketStatus: null,
  href: "/c/x",
});

// jsdom cannot navigate to another document and prints "Not implemented" when a link is followed (M5). The item's own
// click handler still runs; only the browser's default action is cancelled, at the document, after it.
const stopNavigation = (e: MouseEvent) => {
  if ((e.target as Element | null)?.closest?.("a[href]")) e.preventDefault();
};
beforeEach(() => {
  vi.clearAllMocks();
  h.tick = 0;
  document.addEventListener("click", stopNavigation);
});
afterEach(() => {
  document.removeEventListener("click", stopNavigation);
});

describe("NotificationList", () => {
  it("shows an empty state", () => {
    render(<NotificationList initial={[]} initialHasMore={false} />);
    expect(screen.getByText(/no tienes avisos/i)).toBeInTheDocument();
  });

  it("marks everything as read", async () => {
    render(<NotificationList initial={[view(2), view(1)]} initialHasMore={false} />);
    expect(screen.getAllByLabelText(/sin leer/i)).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Marcar todo como leído" }));
    expect(h.markRead).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryAllByLabelText(/sin leer/i)).toHaveLength(0));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("hides the mark-all button when nothing is unread", () => {
    render(<NotificationList initial={[view(1, "2026-10-17T11:00:00Z")]} initialHasMore={false} />);
    expect(screen.queryByRole("button", { name: "Marcar todo como leído" })).toBeNull();
  });

  it("loads more with the keyset cursor of the last item", async () => {
    h.list.mockResolvedValueOnce([view(3)]);
    render(<NotificationList initial={[view(2), view(1)]} initialHasMore />);
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(h.list).toHaveBeenCalledWith(
      { filter: "all", cursor: { createdAt: view(1).createdAt, id: 1 } },
      expect.anything(),
    );
    expect(await screen.findByText(/Miembro3/)).toBeInTheDocument();
  });

  it("switches filter and reloads from the start", async () => {
    h.list.mockResolvedValueOnce([view(5)]);
    render(<NotificationList initial={[view(2)]} initialHasMore={false} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Menciones" }));
    expect(screen.getByRole("button", { name: "Menciones" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "false");
    expect(h.list).toHaveBeenCalledWith({ filter: "mentions" }, expect.anything());
    expect(await screen.findByText(/Miembro5/)).toBeInTheDocument();
  });

  it("opening an unread item marks it read (and only that one)", async () => {
    render(<NotificationList initial={[view(2), view(1)]} initialHasMore={false} />);
    await userEvent.click(screen.getByRole("link", { name: /Miembro2/ }));
    expect(h.markRead).toHaveBeenCalledWith([2]);
    await waitFor(() => expect(screen.getAllByLabelText(/sin leer/i)).toHaveLength(1));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("opening an already read item does not call the server", async () => {
    render(<NotificationList initial={[view(2, "2026-10-17T11:00:00Z")]} initialHasMore={false} />);
    await userEvent.click(screen.getByRole("link", { name: /Miembro2/ }));
    expect(h.markRead).not.toHaveBeenCalled();
  });

  it("reloads the first page when a realtime event arrives", async () => {
    h.list.mockResolvedValue([view(9)]);
    const { rerender } = render(<NotificationList initial={[view(2)]} initialHasMore={false} />);
    h.tick = 1;
    await act(async () => rerender(<NotificationList initial={[view(2)]} initialHasMore={false} />));
    expect(await screen.findByText(/Miembro9/)).toBeInTheDocument();
  });
});
