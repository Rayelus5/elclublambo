import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onCreated: null as null | ((id: number) => void),
  onResync: null as null | (() => void),
  rpc: vi.fn(async () => ({ data: 0, error: null })),
  memberId: null as string | null,
}));
vi.mock("@/lib/notifications/realtime", () => ({
  useNotificationEvents: (id: string, cb: (n: number) => void, opts?: { onResync?: () => void }) => {
    h.memberId = id;
    h.onCreated = cb;
    h.onResync = opts?.onResync ?? null;
  },
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: h.rpc }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";

const ME = "11111111-1111-4111-8111-111111111111";

const setup = (initialCount: number) =>
  render(
    <NotificationsProvider memberId={ME} initialCount={initialCount}>
      <NotificationBell />
    </NotificationsProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.rpc.mockResolvedValue({ data: 0, error: null });
});

describe("NotificationBell", () => {
  it("links to /notifications and subscribes to the member topic", () => {
    setup(0);
    expect(screen.getByRole("link", { name: "Notificaciones" })).toHaveAttribute("href", "/notifications");
    expect(h.memberId).toBe(ME);
  });

  it("shows no badge at 0", () => {
    setup(0);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });

  it("shows the count and announces it", () => {
    setup(3);
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: "Notificaciones, 3 sin leer" })).toBeInTheDocument();
  });

  it("caps the badge at 9+", () => {
    setup(10);
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("9+");
  });

  it("increments on a realtime event", () => {
    setup(0);
    act(() => h.onCreated!(5));
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");
    act(() => h.onCreated!(6));
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("2");
  });

  it("re-reads the count from the server on resync", async () => {
    h.rpc.mockResolvedValue({ data: 4, error: null });
    setup(0);
    await act(async () => h.onResync!());
    expect(h.rpc).toHaveBeenCalledWith("my_unread_notification_count");
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("4");
  });
});
