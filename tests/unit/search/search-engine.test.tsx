import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  searchMessages: vi.fn(),
  searchMembers: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/search/queries", () => ({ searchMessages: h.searchMessages, searchMembers: h.searchMembers }));

import { useSearchEngine } from "@/components/search/use-search-engine";
import { SearchProvider, useSearch } from "@/components/search/search-provider";
import { buildActions } from "@/lib/search/actions-list";
import type { ChannelRow } from "@/lib/channels/tree";

const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as const;
const C1 = "11111111-1111-4111-8111-111111111111";
const channels: ChannelRow[] = [
  { id: "cat", parentId: null, kind: "category", name: "Comunidad", topic: null, position: 0 },
  { id: C1, parentId: "cat", kind: "text", name: "general", topic: null, position: 1 },
];
const actions = buildActions({ perms: 16n, canReports: false, ticketChannels: [], wallet: WALLET });

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  h.searchMessages.mockReset().mockResolvedValue([]);
  h.searchMembers.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("useSearchEngine", () => {
  it("with a single character filters locally and never calls the remote search", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchEngine({ query: " g ", channels, actions }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(result.current.q).toBe("g");
    expect(result.current.remoteEnabled).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(result.current.shownChannels.map((c) => c.id)).toEqual([C1]);
    expect(h.searchMessages).not.toHaveBeenCalled();
    expect(h.searchMembers).not.toHaveBeenCalled();
  });

  it("with two characters searches remotely after the debounce and settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchEngine({ query: "ge", channels, actions }));
    expect(result.current.loading).toBe(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(h.searchMessages).toHaveBeenCalledWith({}, "ge");
    expect(result.current.loading).toBe(false);
    expect(result.current.members).toEqual([]);
  });
});

describe("useSearch", () => {
  it("exposes the layout's channels and actions next to open()", () => {
    let seen: ReturnType<typeof useSearch> | null = null;
    function Probe() {
      seen = useSearch();
      return null;
    }
    render(
      <SearchProvider channels={channels} actions={actions}>
        <Probe />
      </SearchProvider>,
    );
    expect(seen!.channels).toBe(channels);
    expect(seen!.actions).toBe(actions);
    expect(typeof seen!.open).toBe("function");
  });
});

describe("SearchProvider shortcut from the Inicio field (P1-R16)", () => {
  it("Ctrl+K on an expanded combobox inside data-home-search opens the palette", () => {
    render(
      <SearchProvider channels={channels} actions={actions}>
        <div data-home-search="">
          <input role="combobox" aria-expanded="true" aria-controls="home-list" aria-label="Buscar en el club" data-testid="home" />
        </div>
      </SearchProvider>,
    );
    const input = screen.getByTestId("home");
    input.focus();
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void input.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
  });

  it("the data-home-search exception does not unblock other expanded comboboxes", () => {
    render(
      <SearchProvider channels={channels} actions={actions}>
        <div data-home-search="" />
        <input role="combobox" aria-expanded="true" aria-controls="other-list" aria-label="otro" data-testid="other" />
      </SearchProvider>,
    );
    fireEvent.keyDown(screen.getByTestId("other"), { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
