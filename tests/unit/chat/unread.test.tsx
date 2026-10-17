import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc }) }));

import { ChannelTree } from "@/components/shell/channel-tree";
import { UnreadProvider, useUnread } from "@/lib/chat/unread";
import { buildTree, type ChannelRow } from "@/lib/channels/tree";

const r = (id: string, name: string, position: number): ChannelRow => ({ id, parentId: null, kind: "text", name, topic: null, position });
const nodes = buildTree([r("gen", "General", 1), r("rul", "Reglas", 2)]);

function Refresher() {
  const { refresh } = useUnread();
  return (
    <button type="button" onClick={refresh}>
      refrescar
    </button>
  );
}

function renderTree() {
  return render(
    <UnreadProvider>
      <ChannelTree nodes={nodes} />
      <Refresher />
    </UnreadProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  window.localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("unread dots", () => {
  it("marks the channels returned by my_unread_channels with an accessible dot", async () => {
    rpc.mockResolvedValue({ data: ["gen"], error: null });
    renderTree();
    const general = screen.getByRole("link", { name: /General/ });
    await waitFor(() => expect(within(general).getByLabelText("sin leer")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith("my_unread_channels");
    const rules = screen.getByRole("link", { name: /Reglas/ });
    expect(within(rules).queryByLabelText("sin leer")).not.toBeInTheDocument();
  });

  it("renders no dots without unread channels", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderTree();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByLabelText("sin leer")).not.toBeInTheDocument();
  });

  it("ignores rpc errors and keeps the previous state", async () => {
    rpc.mockResolvedValueOnce({ data: ["gen"], error: null });
    renderTree();
    await screen.findByLabelText("sin leer");
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("sin leer")).toBeInTheDocument();
  });

  it("refreshes on demand (events / marking read)", async () => {
    rpc.mockResolvedValueOnce({ data: ["gen"], error: null });
    renderTree();
    await screen.findByLabelText("sin leer");
    rpc.mockResolvedValue({ data: [], error: null });
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    await waitFor(() => expect(screen.queryByLabelText("sin leer")).not.toBeInTheDocument());
  });

  it("polls every 60 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    rpc.mockResolvedValue({ data: [], error: null });
    renderTree();
    await act(async () => void (await Promise.resolve()));
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: ["rul"], error: null });
    await act(async () => void vi.advanceTimersByTime(59_000));
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(1_500));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole("link", { name: /Reglas/ })).getByLabelText("sin leer")).toBeInTheDocument();
  });

  it("coalesces overlapping refreshes into one trailing call", async () => {
    let resolve!: (v: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((res) => (resolve = res)));
    renderTree();
    // initial call in flight; two more requests while it is pending
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: [], error: null });
    await act(async () => resolve({ data: ["gen"], error: null }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  });
});
