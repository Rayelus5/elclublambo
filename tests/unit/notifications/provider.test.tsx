import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  created: null as null | ((id: number) => void),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/notifications/realtime", () => ({
  useNotificationEvents: (_id: string, cb: (id: number) => void) => {
    h.created = cb;
  },
}));

import { NotificationsProvider, useNotifications } from "@/components/notifications/notifications-provider";

function Probe() {
  const { count, refresh } = useNotifications();
  return (
    <button type="button" onClick={refresh}>
      count:{count}
    </button>
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ME = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.rpc.mockReset();
});

describe("NotificationsProvider refresh", () => {
  it("re-runs once after the in-flight read when another refresh was requested meanwhile", async () => {
    const first = deferred<{ data: number; error: null }>();
    const second = deferred<{ data: number; error: null }>();
    h.rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <NotificationsProvider memberId={ME} initialCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    const btn = screen.getByRole("button");
    act(() => btn.click());
    // three more requests while the first read is in flight collapse into a single re-run
    act(() => {
      btn.click();
      btn.click();
      btn.click();
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ data: 1, error: null }));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ data: 4, error: null }));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button")).toHaveTextContent("count:4");
  });

  it("does not re-run when nothing was requested during the read", async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    render(
      <NotificationsProvider memberId={ME} initialCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    await act(async () => screen.getByRole("button").click());
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent("count:2");
  });

  it("can refresh again after a failed read", async () => {
    h.rpc.mockRejectedValueOnce(new Error("net")).mockResolvedValueOnce({ data: 3, error: null });
    render(
      <NotificationsProvider memberId={ME} initialCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    await act(async () => screen.getByRole("button").click());
    await act(async () => screen.getByRole("button").click());
    expect(screen.getByRole("button")).toHaveTextContent("count:3");
  });
});
