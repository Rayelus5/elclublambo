import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ unread: new Set<string>() as ReadonlySet<string> }));
vi.mock("@/lib/chat/unread", () => ({ useUnread: () => ({ unread: h.unread, refresh: () => {} }) }));

import { HomeGreeting } from "@/components/home/home-greeting";
import { QuickTiles } from "@/components/home/quick-tiles";
import { ContinueCards } from "@/components/home/continue-cards";
import { FeaturedPin } from "@/components/home/featured-pin";
import { memberName } from "@/lib/members/name";
import type { HomeHighlights, HomePin, HomeUnreadChannel } from "@/lib/home/queries";

beforeAll(() => {
  // motion's useInView (the staggered entry) needs it; jsdom has none
  globalThis.IntersectionObserver ??= class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const soon = new Date(Date.now() + 3 * 3600_000).toISOString();

const base: HomeHighlights = { openBounties: 0, poll: null, giveaway: null, donor: { isMecenas: false } };
const tiles = () => within(screen.getByRole("list", { name: "Accesos rápidos" }));

describe("HomeGreeting", () => {
  it("keeps the h1 «Inicio» and greets the member by name", () => {
    render(<HomeGreeting name={memberName({ handle: "ana", displayName: null, walletAddress: "0xabc", avatarPath: null })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByText("Buenas, @ana")).toBeInTheDocument();
  });

  it("without a name it still greets", () => {
    render(<HomeGreeting name={null} />);
    expect(screen.getByText("Buenas")).toBeInTheDocument();
  });
});

describe("QuickTiles", () => {
  it("unread, mentions, bounties and donate; no giveaway or poll tile when there is none", () => {
    h.unread = new Set();
    render(<QuickTiles highlights={base} mentions={0} />);
    const t = tiles();
    expect(t.getByRole("link", { name: /Sin leer/ })).toHaveTextContent("Al día");
    expect(t.getByRole("link", { name: /Menciones/ })).toHaveAttribute("href", "/notifications");
    expect(t.getByRole("link", { name: /Bounties/ })).toHaveAttribute("href", "/guia/bounties");
    expect(t.getByRole("link", { name: /Donar/ })).toHaveAttribute("href", "/donar");
    expect(t.queryByRole("link", { name: /Sorteo/ })).not.toBeInTheDocument();
    expect(t.queryByRole("link", { name: /Encuesta/ })).not.toBeInTheDocument();
  });

  it("counts unread channels and links to the newest one; mentions add replies; bounties link to the first", () => {
    h.unread = new Set([C1, C2]);
    render(
      <QuickTiles
        highlights={{ ...base, openBounties: 3 }}
        mentions={5}
        unreadOrder={[C2, C1]}
        bountyHref={`/c/${C1}?m=b1`}
      />,
    );
    const t = tiles();
    const unread = t.getByRole("link", { name: /Sin leer/ });
    expect(unread).toHaveTextContent("2");
    expect(unread).toHaveAttribute("href", `/c/${C2}`);
    expect(t.getByRole("link", { name: /Menciones/ })).toHaveTextContent("5");
    const bounties = t.getByRole("link", { name: /Bounties/ });
    expect(bounties).toHaveTextContent("3");
    expect(bounties).toHaveAttribute("href", `/c/${C1}?m=b1`);
  });

  it("an open giveaway and an open poll get their tiles", () => {
    h.unread = new Set();
    render(
      <QuickTiles
        highlights={{
          ...base,
          giveaway: { id: "g1", title: "Camiseta del club", closesAt: soon, iEntered: false },
          poll: { messageId: "p1", channelId: C1, question: "¿Pizza o sushi?", closesAt: soon },
        }}
        mentions={0}
      />,
    );
    const t = tiles();
    const g = t.getByRole("link", { name: /Sorteo/ });
    expect(g).toHaveAttribute("href", "/sorteos/g1");
    expect(g).toHaveTextContent("Camiseta del club");
    expect(g).toHaveTextContent(/Cierra/);
    const p = t.getByRole("link", { name: /Encuesta/ });
    expect(p).toHaveAttribute("href", `/c/${C1}?m=p1`);
    expect(p).toHaveTextContent("¿Pizza o sushi?");
  });

  it("«Mecenas» replaces «Donar» for a Mecenas", () => {
    h.unread = new Set();
    render(<QuickTiles highlights={{ ...base, donor: { isMecenas: true } }} mentions={0} />);
    const t = tiles();
    expect(t.getByRole("link", { name: /Mecenas/ })).toHaveAttribute("href", "/donar");
    expect(t.queryByText("Donar")).not.toBeInTheDocument();
  });

  it("every tile is a 44 px target", () => {
    h.unread = new Set();
    render(<QuickTiles highlights={base} mentions={0} />);
    for (const link of tiles().getAllByRole("link")) expect(link.className).toMatch(/min-h-/);
  });
});

const chan = (id: string, name: string, n: number): HomeUnreadChannel => ({
  channelId: id,
  channelName: name,
  unreadCount: n,
  lastExcerpt: `último de ${name}`,
  lastAuthor: "@ana",
  lastAt: new Date().toISOString(),
});

describe("ContinueCards", () => {
  it("empty: «Estás al día.»", () => {
    render(<ContinueCards channels={[]} />);
    expect(screen.getByRole("heading", { name: "Continúa donde lo dejaste" })).toBeInTheDocument();
    expect(screen.getByText("Estás al día.")).toBeInTheDocument();
  });

  it("one card per channel (6 at most) with #canal, «N nuevos», excerpt and author", () => {
    const list = Array.from({ length: 8 }, (_, i) => chan(`c${i}`, `canal${i}`, i + 1));
    list[0] = chan(C1, "trading", 1);
    render(<ContinueCards channels={list} />);
    const cards = screen.getAllByRole("link");
    expect(cards).toHaveLength(6);
    expect(cards[0]).toHaveAttribute("href", `/c/${C1}`);
    expect(cards[0]).toHaveTextContent("#trading");
    expect(cards[0]).toHaveTextContent("1 nuevo");
    expect(cards[1]).toHaveTextContent("2 nuevos");
    expect(cards[0]).toHaveTextContent("último de trading");
    expect(cards[0]).toHaveTextContent("@ana");
  });
});

const pin = (id: string, excerpt: string, pinnedAt: string): HomePin => ({
  messageId: id,
  channelId: C1,
  channelName: "anuncios",
  authorLabel: "@admin",
  excerpt,
  pinnedAt,
});

describe("FeaturedPin", () => {
  it("shows the newest pin big; «Ver todos (N)» unfolds the rest", () => {
    render(
      <FeaturedPin
        pins={[
          pin("p1", "Reunión el viernes", "2026-10-20T10:00:00Z"),
          pin("p2", "Normas del club", "2026-10-23T10:00:00Z"),
          pin("p3", "Calendario", "2026-10-01T10:00:00Z"),
        ]}
      />,
    );
    const featured = screen.getByRole("link", { name: /Normas del club/ });
    expect(featured).toHaveAttribute("href", `/c/${C1}?m=p2`);
    expect(screen.queryByRole("link", { name: /Reunión el viernes/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Ver todos (3)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Reunión el viernes/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Calendario/ })).toBeInTheDocument();
  });

  it("a single pin has no «Ver todos»; none renders nothing", () => {
    const { container, rerender } = render(<FeaturedPin pins={[pin("p1", "Solo uno", "2026-10-20T10:00:00Z")]} />);
    expect(screen.queryByRole("button", { name: /Ver todos/ })).not.toBeInTheDocument();
    rerender(<FeaturedPin pins={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
