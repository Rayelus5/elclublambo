import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", async (orig) => ({
  ...(await orig<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: status.pending }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/chat/unread", () => ({ useUnread: () => ({ unread: new Set<string>() }) }));

import { Diamond } from "@/components/loading-ui/diamond";
import { PageLoader } from "@/components/shell/page-loader";
import { LinkPending } from "@/components/shell/link-pending";
import { NavLink } from "@/components/shell/nav-link";
import { ChannelTree } from "@/components/shell/channel-tree";
import { ChatHistoryLoading } from "@/components/chat/chat-history-loading";
import ForumLoading from "@/app/foro/(forum)/loading";
import { buildTree } from "@/lib/channels/tree";

beforeEach(() => {
  status.pending = false;
});

describe("Diamond", () => {
  it("draws eight pixels in currentColor", () => {
    const { container } = render(<Diamond />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg.querySelectorAll("rect")).toHaveLength(8);
  });
});

describe("PageLoader", () => {
  it("announces «Cargando…» to screen readers", () => {
    render(<PageLoader />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("takes a custom label", () => {
    render(<PageLoader label="Cargando mensajes…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando mensajes…");
  });

  it("shows the accent-coloured diamond, hidden from assistive tech, fading in after a delay", () => {
    const { container } = render(<PageLoader />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).toHaveClass("size-10", "text-accent", "animate-loader-in");
  });

  it("reserves the same height as the old empty fallback (no layout jump)", () => {
    render(<PageLoader />);
    expect(screen.getByRole("status")).toHaveClass("min-h-64");
  });

  it("is the route loading UI of the forum content area", () => {
    render(<ForumLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });
});

describe("ChatHistoryLoading", () => {
  it("draws a skeleton of the channel and its messages, announced as «Cargando mensajes…»", () => {
    const { container } = render(<ChatHistoryLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Cargando mensajes…");
    // Grey lines instead of the diamond: hidden from assistive tech, which only hears the status text.
    expect(container.querySelector("svg")).toBeNull();
    const rows = container.querySelectorAll("[data-skeleton-message]");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]!.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("keeps the chat panel's height (no jump when the history arrives) and pulses only without reduced motion", () => {
    const { container } = render(<ChatHistoryLoading />);
    const panel = container.querySelector("[data-skeleton-panel]")!;
    expect(panel).toHaveClass("h-[calc(100dvh-13rem)]", "min-h-[28rem]", "md:h-[calc(100dvh-15.5rem)]");
    const pulse = container.querySelector(".animate-pulse")!;
    expect(pulse).toHaveClass("motion-reduce:animate-none");
  });

  it("fades in after a delay, so a fast channel switch shows nothing", () => {
    render(<ChatHistoryLoading />);
    expect(screen.getByRole("status")).toHaveClass("animate-loader-in");
  });
});

describe("LinkPending", () => {
  it("always reserves its fixed-size slot, empty while the link is idle", () => {
    const { container } = render(<LinkPending />);
    const hint = container.querySelector("[data-link-pending]")!;
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(hint).toHaveAttribute("data-link-pending", "false");
    expect(hint).toHaveClass("size-3", "shrink-0");
    expect(hint.querySelector("svg")).toBeNull();
  });

  it("fades in the accent diamond while the navigation is pending", () => {
    status.pending = true;
    const { container } = render(<LinkPending />);
    const hint = container.querySelector("[data-link-pending]")!;
    expect(hint).toHaveAttribute("data-link-pending", "true");
    expect(hint.querySelector("svg")).toHaveClass("size-3", "text-accent", "animate-loader-in");
  });

  it("is wired into the sidebar links (sections and channels)", () => {
    status.pending = true;
    render(
      <>
        <NavLink href="/dao">DAO</NavLink>
        <NavLink href="/mercado" variant="top">
          Mercado
        </NavLink>
        <ChannelTree nodes={buildTree([{ id: "gen", parentId: null, kind: "text", name: "General", topic: null, position: 1 }])} />
      </>,
    );
    for (const name of ["DAO", "Mercado", "General"]) {
      expect(screen.getByRole("link", { name }).querySelector('[data-link-pending="true"]')).not.toBeNull();
    }
  });
});
