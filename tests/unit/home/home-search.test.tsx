import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  searchMessages: vi.fn(),
  searchMembers: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/search/queries", () => ({ searchMessages: h.searchMessages, searchMembers: h.searchMembers }));

import { HomeSearch } from "@/components/home/home-search";
import { SearchProvider } from "@/components/search/search-provider";
import { buildActions } from "@/lib/search/actions-list";
import type { ChannelRow } from "@/lib/channels/tree";

const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as const;
const C1 = "11111111-1111-4111-8111-111111111111";
const channels: ChannelRow[] = [
  { id: "cat", parentId: null, kind: "category", name: "Comunidad", topic: null, position: 0 },
  { id: C1, parentId: "cat", kind: "text", name: "general", topic: null, position: 1 },
];
const actions = buildActions({ perms: 16n, canReports: false, ticketChannels: [], wallet: WALLET });
const M1 = "33333333-3333-4333-8333-333333333333";
const hit = (id: string, snippet: string) => ({
  id,
  channelId: C1,
  threadRootId: null,
  authorId: "a",
  authorName: "Ana",
  createdAt: new Date().toISOString(),
  snippet,
});

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  h.push.mockReset();
  h.searchMessages.mockReset().mockResolvedValue([]);
  h.searchMembers.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

function setup() {
  render(
    <SearchProvider channels={channels} actions={actions}>
      <HomeSearch />
    </SearchProvider>,
  );
  return screen.getByRole("combobox", { name: "Buscar en ElClub." });
}

async function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
}

describe("HomeSearch", () => {
  it("is a big labelled field with the palette's placeholder; the panel stays folded until focus", () => {
    const input = setup();
    expect(input).toHaveAttribute("placeholder", "Busca canales, miembros y mensajes…");
    expect(input.closest("[data-home-search]")).not.toBeNull();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Canales")).toBeInTheDocument();
  });

  it("with «ab» searches remotely after 200 ms and paints the groups", async () => {
    vi.useFakeTimers();
    h.searchMessages.mockResolvedValueOnce([hit(M1, "ab de mensaje")]);
    const input = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(h.searchMessages).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(60)));
    expect(h.searchMessages).toHaveBeenCalledTimes(1);
    expect(h.searchMessages.mock.calls[0]![1]).toBe("ab");
    expect(screen.getByText("Mensajes")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /de mensaje/ })).toBeInTheDocument();
  });

  it("choosing a result navigates like the palette and folds the panel", async () => {
    vi.useFakeTimers();
    h.searchMessages.mockResolvedValueOnce([hit(M1, "hola mundo")]);
    const input = setup();
    fireEvent.focus(input);
    await type(input, "hola");
    fireEvent.click(screen.getByRole("option", { name: /hola/ }));
    expect(h.push.mock.calls[0]![0]).toMatch(new RegExp(`^/c/${C1}\\?m=${M1}&h=`));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("Esc empties the field and folds the panel", async () => {
    vi.useFakeTimers();
    const input = setup();
    fireEvent.focus(input);
    await type(input, "general");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("a click outside folds the panel", () => {
    const input = setup();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Ctrl+K with the focus in the field opens the palette (P1-R16)", () => {
    const input = setup();
    input.focus();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
  });
});
