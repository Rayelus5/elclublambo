import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/foro" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { ChannelTree } from "@/components/shell/channel-tree";
import { Sidebar } from "@/components/shell/sidebar";
import { buildTree, type ChannelRow } from "@/lib/channels/tree";

const r = (
  id: string,
  parentId: string | null,
  kind: ChannelRow["kind"],
  name: string,
  position = 1,
): ChannelRow => ({ id, parentId, kind, name, topic: null, position });

const ROWS: ChannelRow[] = [
  r("cat1", null, "category", "Comunidad", 1),
  r("gen", "cat1", "text", "General", 1),
  r("rul", "cat1", "text", "Reglas", 2),
  r("cat2", null, "category", "Mercado", 2),
  r("air", "cat2", "forum", "Airdrops", 1),
  r("l1", "air", "text", "L1", 1),
  r("tr", "cat2", "text", "Trading", 2),
];
const nodes = buildTree(ROWS);

beforeEach(() => {
  pathname.value = "/foro";
  window.localStorage.clear();
});

describe("ChannelTree", () => {
  it("renders categories as buttons and text channels as /c/<id> links", () => {
    render(<ChannelTree nodes={nodes} />);
    expect(screen.getByRole("button", { name: /Comunidad/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/foro/c/gen");
    expect(screen.getByRole("link", { name: "Trading" })).toHaveAttribute("href", "/foro/c/tr");
    expect(screen.getByRole("link", { name: "General" })).toHaveClass("min-h-11");
  });

  it("forums are collapsed by default and expand with the keyboard", async () => {
    const user = userEvent.setup();
    render(<ChannelTree nodes={nodes} />);
    const forum = screen.getByRole("button", { name: /Airdrops/ });
    expect(forum).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "L1" })).toBeNull();
    forum.focus();
    await user.keyboard("{Enter}");
    expect(forum).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "L1" })).toHaveAttribute("href", "/foro/c/l1");
    await user.keyboard(" ");
    expect(forum).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses a category with Enter/Space and hides its children", async () => {
    const user = userEvent.setup();
    render(<ChannelTree nodes={nodes} />);
    const cat = screen.getByRole("button", { name: /Comunidad/ });
    cat.focus();
    await user.keyboard("{Enter}");
    expect(cat).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "General" })).toBeNull();
    await user.keyboard(" ");
    expect(cat).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
  });

  it("persists collapsed categories in localStorage and restores them", () => {
    const { unmount } = render(<ChannelTree nodes={nodes} />);
    fireEvent.click(screen.getByRole("button", { name: /Comunidad/ }));
    expect(JSON.parse(window.localStorage.getItem("elclub:collapsed") ?? "[]")).toEqual(["cat1"]);
    unmount();
    render(<ChannelTree nodes={nodes} />);
    expect(screen.getByRole("button", { name: /Comunidad/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "General" })).toBeNull();
    expect(screen.getByRole("link", { name: "Trading" })).toBeInTheDocument();
  });

  it("survives a broken localStorage value", () => {
    window.localStorage.setItem("elclub:collapsed", "{nope");
    render(<ChannelTree nodes={nodes} />);
    expect(screen.getByRole("button", { name: /Comunidad/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("marks only the active channel with aria-current", () => {
    pathname.value = "/foro/c/rul";
    render(<ChannelTree nodes={nodes} />);
    expect(screen.getByRole("link", { name: "Reglas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
  });

  it("auto-expands the ancestors of the active channel, even if persisted as collapsed", () => {
    window.localStorage.setItem("elclub:collapsed", JSON.stringify(["cat2"]));
    pathname.value = "/foro/c/l1";
    render(<ChannelTree nodes={nodes} />);
    expect(screen.getByRole("button", { name: /Mercado/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Airdrops/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "L1" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the stored preference of a revealed ancestor when toggling another category", () => {
    window.localStorage.setItem("elclub:collapsed", JSON.stringify(["cat2"]));
    pathname.value = "/foro/c/l1";
    render(<ChannelTree nodes={nodes} />);
    fireEvent.click(screen.getByRole("button", { name: /Comunidad/ }));
    expect(new Set(JSON.parse(window.localStorage.getItem("elclub:collapsed") ?? "[]"))).toEqual(
      new Set(["cat1", "cat2"]),
    );
  });

  it("uses an inset focus ring so the sidebar scroller never clips it", () => {
    render(<ChannelTree nodes={nodes} />);
    for (const el of [
      screen.getByRole("link", { name: "General" }),
      screen.getByRole("button", { name: /Comunidad/ }),
      screen.getByRole("button", { name: /Airdrops/ }),
      screen.getByRole("link", { name: "Abrir Airdrops" }),
    ]) {
      expect(el).toHaveClass("focus-visible:ring-inset");
      expect(el.className).not.toContain("ring-offset");
    }
  });

  it("renders nothing visible for an empty tree without crashing", () => {
    render(<ChannelTree nodes={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Sidebar with channels", () => {
  it("shows the tree below the main nav in both the drawer and the aside", () => {
    render(<Sidebar perms={7n} wallet="0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" channels={ROWS} />);
    const aside = screen.getByRole("complementary");
    expect(within(aside).getByRole("navigation", { name: "Canales" })).toBeInTheDocument();
    expect(within(aside).getByRole("link", { name: "General" })).toHaveAttribute("href", "/foro/c/gen");
  });

  it.each([[128n], [64n], [512n]])("shows the Ajustes link for perms %s", async (perms) => {
    render(<Sidebar perms={perms} wallet="0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" channels={ROWS} />);
    const desktopBar = screen.getAllByRole("banner")[0]!;
    // Staff sections live in the «Más» menu of the top bar.
    await userEvent.setup().click(within(desktopBar).getByRole("button", { name: "Más" }));
    expect(await screen.findByRole("menuitem", { name: "Ajustes" })).toHaveAttribute("href", "/foro/settings");
  });

  it("hides the Ajustes link without manage permissions", () => {
    render(<Sidebar perms={7n} wallet="0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" channels={ROWS} />);
    expect(screen.queryByRole("link", { name: "Ajustes" })).toBeNull();
  });
});

describe("ChannelTree locked rows", () => {
  const withLock = buildTree([
    ...ROWS,
    { id: "vip", parentId: "cat1", kind: "text", name: "VIP", topic: null, position: 3, locked: true },
    { id: "vcat", parentId: null, kind: "category", name: "Socios", topic: null, position: 3, locked: true },
  ]);
  it("a locked text channel keeps its link, shows the lock and is labelled 'bloqueado'", () => {
    render(<ChannelTree nodes={withLock} />);
    const link = screen.getByRole("link", { name: "VIP, bloqueado" });
    expect(link).toHaveAttribute("href", "/foro/c/vip");
    expect(link.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(screen.getByRole("link", { name: "General" }).querySelector("svg.lucide-lock")).toBeNull();
  });
  it("a locked category is labelled too", () => {
    render(<ChannelTree nodes={withLock} />);
    expect(screen.getByRole("button", { name: "Socios, bloqueado" })).toHaveAttribute("aria-expanded", "true");
  });
});
