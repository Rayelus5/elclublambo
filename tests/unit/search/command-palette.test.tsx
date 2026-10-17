import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  searchMessages: vi.fn(),
  searchMembers: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/search/queries", () => ({ searchMessages: h.searchMessages, searchMembers: h.searchMembers }));

import { CommandPalette } from "@/components/search/command-palette";
import { SearchProvider } from "@/components/search/search-provider";
import { buildActions } from "@/lib/search/actions-list";
import type { ChannelRow } from "@/lib/channels/tree";

const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as const;
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const channels: ChannelRow[] = [
  { id: "cat", parentId: null, kind: "category", name: "Comunidad", topic: null, position: 0 },
  { id: "forum", parentId: "cat", kind: "forum", name: "Foro de ideas", topic: null, position: 1 },
  { id: C1, parentId: "cat", kind: "text", name: "general", topic: null, position: 2 },
  { id: C2, parentId: "cat", kind: "text", name: "línea", topic: null, position: 3 },
];
const actions = buildActions({ perms: 16n, canReports: false, ticketChannels: [{ id: C1, name: "general" }], wallet: WALLET });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeAll(() => {
  // cmdk needs these in jsdom
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  h.push.mockReset();
  h.searchMessages.mockReset().mockResolvedValue([]);
  h.searchMembers.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

function setup(onOpenChange = vi.fn()) {
  render(<CommandPalette open onOpenChange={onOpenChange} channels={channels} actions={actions} />);
  return { onOpenChange, input: screen.getByRole("combobox") };
}

async function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
}

describe("CommandPalette", () => {
  it("has an accessible title and lists Acciones then Canales on an empty query (no forums or categories)", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby"));
    expect(groups).toHaveLength(2);
    expect(screen.getByText("Acciones")).toBeInTheDocument();
    expect(screen.getByText("Canales")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Crear invitación/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "general" })).toBeInTheDocument();
    expect(screen.queryByText("Foro de ideas")).not.toBeInTheDocument();
    expect(screen.queryByText("Comunidad")).not.toBeInTheDocument();
    expect(h.searchMessages).not.toHaveBeenCalled();
  });

  it("filters actions and channels locally ignoring accents", async () => {
    vi.useFakeTimers();
    const { input } = setup();
    await type(input, "LINEA");
    expect(screen.getByRole("option", { name: /línea/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "general" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Crear invitación/ })).not.toBeInTheDocument();
  });

  it("debounces 200 ms before searching remotely", async () => {
    vi.useFakeTimers();
    const { input } = setup();
    fireEvent.change(input, { target: { value: "li" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    fireEvent.change(input, { target: { value: "lin" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(h.searchMessages).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(60)));
    expect(h.searchMessages).toHaveBeenCalledTimes(1);
    expect(h.searchMessages.mock.calls[0]![1]).toBe("lin");
    expect(h.searchMembers.mock.calls[0]![1]).toBe("lin");
  });

  it("does not search remotely for a single character", async () => {
    vi.useFakeTimers();
    const { input } = setup();
    await type(input, "l");
    expect(h.searchMessages).not.toHaveBeenCalled();
  });

  it("discards a slow stale response: 'lin' resolving after 'linea' does not overwrite it", async () => {
    vi.useFakeTimers();
    const slow = deferred<unknown[]>();
    const fast = deferred<unknown[]>();
    h.searchMessages.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const { input } = setup();
    await type(input, "lin");
    await type(input, "linea");
    await act(async () => fast.resolve([hit("m-linea", "texto de linea")]));
    expect(screen.getByText(/texto de/)).toBeInTheDocument();
    await act(async () => slow.resolve([hit("m-lin", "resultado viejo lin")]));
    expect(screen.queryByText(/resultado viejo/)).not.toBeInTheDocument();
    expect(screen.getByText(/texto de/)).toBeInTheDocument();
  });

  it("shows Buscando…, then Sin resultados, with the query quoted", async () => {
    vi.useFakeTimers();
    const d = deferred<unknown[]>();
    h.searchMessages.mockReturnValueOnce(d.promise);
    const { input } = setup();
    await type(input, "zzzz");
    expect(screen.getByText("Buscando…")).toBeInTheDocument();
    await act(async () => d.resolve([]));
    expect(screen.queryByText("Buscando…")).not.toBeInTheDocument();
    expect(screen.getByText("Sin resultados para «zzzz»")).toBeInTheDocument();
  });

  it("shows an error when the search fails, keeping local results", async () => {
    vi.useFakeTimers();
    h.searchMessages.mockRejectedValueOnce(new Error("boom"));
    const { input } = setup();
    await type(input, "general");
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo buscar. Inténtalo de nuevo.");
    expect(screen.getByRole("option", { name: "general" })).toBeInTheDocument();
  });

  it("orders groups Acciones, Canales, Miembros, Mensajes and renders text only", async () => {
    vi.useFakeTimers();
    h.searchMembers.mockResolvedValueOnce([{ id: "a", displayName: "Ana general", walletAddress: "0xabc" }]);
    h.searchMessages.mockResolvedValueOnce([hit("m1", "la <b>general</b> idea")]);
    const { input } = setup();
    await type(input, "general");
    const headings = Array.from(document.querySelectorAll("[cmdk-group-heading]")).map((n) => n.textContent);
    expect(headings).toEqual(["Acciones", "Canales", "Miembros", "Mensajes"]);
    const msg = screen.getByRole("option", { name: /idea/ });
    expect(msg.querySelector("b")).toBeNull();
    expect(within(msg).getByText("general", { selector: "mark" })).toBeInTheDocument();
    expect(msg).toHaveTextContent("#general · Ana · ");
  });

  it("choosing a root message goes to ?m= with a nonce and closes", async () => {
    vi.useFakeTimers();
    h.searchMessages.mockResolvedValueOnce([hit("33333333-3333-4333-8333-333333333333", "hola linea")]);
    const { input, onOpenChange } = setup();
    await type(input, "linea");
    fireEvent.click(screen.getByRole("option", { name: /hola/ }));
    const url = h.push.mock.calls[0]![0] as string;
    expect(url).toMatch(new RegExp(`^/c/${C1}\\?m=33333333-3333-4333-8333-333333333333&h=[A-Za-z0-9_-]{1,32}$`));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("choosing a reply goes to ?thread=<root>&m=<id>", async () => {
    vi.useFakeTimers();
    const R = "44444444-4444-4444-8444-444444444444";
    h.searchMessages.mockResolvedValueOnce([{ ...hit("33333333-3333-4333-8333-333333333333", "respuesta linea"), threadRootId: R }]);
    const { input } = setup();
    await type(input, "linea");
    fireEvent.click(screen.getByRole("option", { name: /respuesta/ }));
    expect(h.push.mock.calls[0]![0]).toMatch(new RegExp(`^/c/${C1}\\?thread=${R}&m=3333`));
  });

  it("choosing a member, a channel and an action navigates", async () => {
    vi.useFakeTimers();
    h.searchMembers.mockResolvedValueOnce([{ id: "a", displayName: "Ana general", walletAddress: "0xabc" }]);
    const { input } = setup();
    await type(input, "general");
    fireEvent.click(screen.getByRole("option", { name: /Ana general/ }));
    expect(h.push).toHaveBeenLastCalledWith("/u/0xabc");
    fireEvent.click(screen.getByRole("option", { name: "general" }));
    expect(h.push).toHaveBeenLastCalledWith(`/c/${C1}`);
    fireEvent.click(screen.getByRole("option", { name: /Abrir ticket en #general/ }));
    expect(h.push).toHaveBeenLastCalledWith(`/c/${C1}?openTicket=1`);
  });
});

describe("SearchProvider shortcut", () => {
  function mount() {
    render(
      <SearchProvider channels={channels} actions={actions}>
        <button type="button">antes</button>
        <div role="textbox" contentEditable suppressContentEditableWarning data-testid="editor" tabIndex={0} />
      </SearchProvider>,
    );
  }

  it("opens with Ctrl+K and with Meta+K, calling preventDefault", () => {
    mount();
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
  });

  it("opens with Meta+K", () => {
    mount();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
  });

  it("ignores plain k and Shift/Alt combinations, without preventing default", () => {
    mount();
    for (const init of [{ key: "k" }, { key: "k", ctrlKey: true, shiftKey: true }, { key: "k", metaKey: true, altKey: true }]) {
      const ev = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      act(() => void document.dispatchEvent(ev));
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not open while a composer suggestion popup is open, and leaves the event alone", () => {
    mount();
    const popup = document.createElement("div");
    popup.setAttribute("data-suggestion-popup", "");
    document.body.appendChild(popup);
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void screen.getByTestId("editor").dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    popup.remove();
  });

  it("does not open from an editor whose aria-expanded is true", () => {
    mount();
    const editor = screen.getByTestId("editor");
    editor.setAttribute("aria-expanded", "true");
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void editor.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the editor when no suggestion is open", () => {
    mount();
    const editor = screen.getByTestId("editor");
    editor.focus();
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
  });

  it("Escape closes and returns focus to the previously focused element", async () => {
    vi.useFakeTimers();
    mount();
    const before = screen.getByRole("button", { name: "antes" });
    before.focus();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Buscar" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(before).toHaveFocus();
  });
});

function hit(id: string, snippet: string) {
  return {
    id,
    channelId: C1,
    threadRootId: null,
    authorId: "a1",
    authorName: "Ana",
    createdAt: "2026-10-01T10:00:00Z",
    snippet,
  };
}
