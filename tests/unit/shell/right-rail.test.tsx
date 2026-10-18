import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ path: "/", rpc: vi.fn(), topic: vi.fn(), desktop: true }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/realtime/private-topic", () => ({ usePrivateTopic: h.topic }));
vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: () => h.desktop }));

import { RightRail } from "@/components/shell/right-rail";
import { ShellGrid } from "@/components/shell/shell-grid";

const CH = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.desktop = true;
  localStorage.clear();
  h.topic.mockReset();
  h.rpc.mockReset().mockImplementation(async (fn: string) => {
    if (fn === "channel_overview") return { data: { name: "general", topic: "Charla del club" }, error: null };
    if (fn === "channel_members")
      return {
        data: [
          { member_id: "33333333-3333-4333-8333-333333333331", handle: "ana", display_name: null, wallet_address: "0x1111111111111111111111111111111111111111", avatar_path: null, online: true, role_color: "#61DFFF" },
          { member_id: "33333333-3333-4333-8333-333333333332", handle: "beto", display_name: null, wallet_address: "0x2222222222222222222222222222222222222222", avatar_path: null, online: false, role_color: null },
        ],
        error: null,
      };
    if (fn === "home_pinned") return { data: [{ message_id: "p1", channel_id: CH, channel_name: "general", author_label: null, excerpt: "Normas", pinned_at: "" }], error: null };
    if (fn === "home_open_bounties") return { data: [], error: null };
    if (fn === "club_activity")
      return { data: [{ kind: "donation", at: "2026-10-18T10:00:00Z", actor_label: "@eva", token: "USDC", amount_text: "10000000" }], error: null };
    return { data: null, error: { message: "unexpected" } };
  });
});

const renderRail = () =>
  render(
    <ShellGrid>
      <RightRail />
    </ShellGrid>,
  );

describe("RightRail", () => {
  it("inside a channel shows that channel: topic, members, pins and bounties", async () => {
    h.path = `/c/${CH}`;
    renderRail();
    expect(await screen.findByText("#general")).toBeInTheDocument();
    expect(screen.getByText("Charla del club")).toBeInTheDocument();
    const online = await screen.findByRole("list", { name: "Miembros en línea" });
    expect(online).toHaveTextContent("@ana");
    expect(screen.getByRole("list", { name: "Miembros desconectados" })).toHaveTextContent("@beto");
    expect(screen.getByText("En línea — 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver tarjeta de @ana" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Normas/ })).toHaveAttribute("href", `/c/${CH}?m=p1`);
    expect(screen.getByText("Ninguno abierto aquí.")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("home_pinned", { p_limit: 5, p_channel: CH });
  });

  it("elsewhere shows the live club activity and listens on the activity topic", async () => {
    h.path = "/dao";
    renderRail();
    expect(await screen.findByRole("link", { name: /@eva donó 10 USDC a la DAO/ })).toBeInTheDocument();
    expect(h.topic).toHaveBeenCalledWith("activity", "activity_changed", expect.any(Object));
  });

  it("can be folded and unfolded, and remembers it", async () => {
    h.path = "/";
    renderRail();
    await userEvent.click(screen.getByRole("button", { name: "Ocultar panel lateral" }));
    expect(screen.getByRole("button", { name: "Mostrar panel lateral" })).toBeInTheDocument();
    expect(localStorage.getItem("elclub:rail-collapsed")).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar panel lateral" }));
    expect(screen.getByRole("button", { name: "Ocultar panel lateral" })).toBeInTheDocument();
  });

  it("a channel it cannot read shows a short error, not someone else's data", async () => {
    h.path = `/c/${CH}`;
    h.rpc.mockImplementation(async () => ({ data: null, error: { message: "not_found" } }));
    renderRail();
    expect(await screen.findByText("No se pudo cargar el canal.")).toBeInTheDocument();
  });

  it("below desktop width it neither fetches nor subscribes (the rail is not shown there)", () => {
    h.desktop = false;
    h.path = "/";
    renderRail();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.topic).not.toHaveBeenCalled();
  });

  it("activity only re-reads the channel's open bounties, not the costly member count", async () => {
    h.path = `/c/${CH}`;
    renderRail();
    await screen.findByText("#general");
    const before = h.rpc.mock.calls.length;
    const handlers = h.topic.mock.calls.findLast((c) => c[0] === "activity")![2] as { onEvent: () => void };
    act(() => handlers.onEvent());
    await waitFor(() => expect(h.rpc.mock.calls.length).toBe(before + 1));
    expect(h.rpc.mock.calls.at(-1)![0]).toBe("home_open_bounties");
  });

  it("a presence event moves a member between the online and offline groups live (offline after a short grace)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.path = `/c/${CH}`;
    renderRail();
    await screen.findByRole("list", { name: "Miembros en línea" });
    const handlers = h.topic.mock.calls.findLast((c) => c[0] === "presence")![2] as { onEvent: (p: unknown) => void };
    act(() => handlers.onEvent({ member_id: "33333333-3333-4333-8333-333333333331", online: false }));
    expect(screen.getByText("En línea — 1")).toBeInTheDocument(); // not yet: a reload would come straight back
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("En línea — 0")).toBeInTheDocument();
    vi.useRealTimers();
    expect(screen.getByRole("list", { name: "Miembros desconectados" })).toHaveTextContent("@ana");
  });

  it("a channel the member cannot view (DAO-locked) shows the club activity, without errors", async () => {
    h.path = `/c/${CH}`;
    const base = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (fn: string, args?: unknown) => (fn === "channel_overview" ? { data: null, error: null } : base(fn, args)));
    renderRail();
    expect(await screen.findByRole("link", { name: /@eva donó 10 USDC a la DAO/ })).toBeInTheDocument();
    expect(screen.queryByText("No se pudo cargar el canal.")).not.toBeInTheDocument();
  });
});
