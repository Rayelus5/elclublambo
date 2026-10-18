import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { Sidebar } from "@/components/shell/sidebar";

const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as const;

beforeEach(() => {
  pathname.value = "/";
});

function renderSidebar(perms: bigint) {
  return render(<Sidebar perms={perms} wallet={WALLET} />);
}

/** The desktop top bar (rendered first); the second banner is the mobile bar. */
const desktopBar = () => screen.getAllByRole("banner")[0]!;
const mobileBar = () => screen.getAllByRole("banner")[1]!;

describe("Sidebar", () => {
  it("shows a Buscar button in the desktop top bar and in the mobile top bar", () => {
    renderSidebar(7n);
    expect(within(desktopBar()).getByRole("button", { name: /^Buscar/ })).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    expect(within(mobileBar()).getByRole("button", { name: "Buscar" })).toBeInTheDocument();
  });

  it("puts the primary navigation in the desktop top bar, horizontally", () => {
    renderSidebar(512n);
    const nav = within(desktopBar()).getByRole("navigation", { name: "Principal" });
    expect(nav.querySelector("ul")).toHaveClass("flex-row");
    for (const name of ["Inicio", "Tickets", "Invitaciones", "Miembros", "Ajustes"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("keeps the desktop top bar hidden below 768px and the mobile bar hidden above", () => {
    renderSidebar(7n);
    expect(desktopBar()).toHaveClass("hidden", "md:flex");
    expect(mobileBar()).toHaveClass("md:hidden");
  });

  it("leaves only the channels in the aside", () => {
    render(<Sidebar perms={512n} wallet={WALLET} canModerate />);
    const aside = screen.getByRole("complementary");
    expect(within(aside).getByRole("navigation", { name: "Canales" })).toBeInTheDocument();
    for (const name of ["Inicio", "Tickets", "Invitaciones", "Miembros", "Reportes", "Ajustes", /Mi perfil/]) {
      expect(within(aside).queryByRole("link", { name })).toBeNull();
    }
    expect(within(aside).queryByRole("button", { name: "Salir" })).toBeNull();
  });

  it("underlines the active top bar link and labels it for screen readers at every width", () => {
    pathname.value = "/tickets";
    renderSidebar(7n);
    const link = within(desktopBar()).getByRole("link", { name: "Tickets" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("border-b-2", "border-accent");
    expect(within(desktopBar()).getByRole("link", { name: "Inicio" })).toHaveClass("border-transparent");
  });

  it("has the bell, the profile and sign out on the right of the desktop top bar", () => {
    renderSidebar(7n);
    const bar = within(desktopBar());
    expect(bar.getByRole("link", { name: "Notificaciones" })).toHaveAttribute("href", "/notifications");
    expect(bar.getByRole("link", { name: /Mi perfil/ })).toHaveAttribute("href", `/u/${WALLET}`);
    expect(bar.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("always shows Inicio", () => {
    renderSidebar(7n);
    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
  });

  it("hides Invitaciones and Miembros without the bits", () => {
    renderSidebar(7n);
    expect(screen.queryByRole("link", { name: "Invitaciones" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
  });

  it("shows Invitaciones with bit 16 (and no Miembros)", () => {
    renderSidebar(16n);
    expect(screen.getByRole("link", { name: "Invitaciones" })).toHaveAttribute("href", "/invites");
    expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
  });

  it("shows both with ADMINISTRATOR (512)", () => {
    renderSidebar(512n);
    expect(screen.getByRole("link", { name: "Invitaciones" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Miembros" })).toHaveAttribute("href", "/admin/members");
  });

  it("shows Miembros with bit 32 (and no Invitaciones)", () => {
    renderSidebar(32n);
    expect(screen.getByRole("link", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Invitaciones" })).toBeNull();
  });

  it("renders the short address in mono inside the profile link", () => {
    renderSidebar(7n);
    const profile = screen.getByRole("link", { name: /Mi perfil/ });
    expect(profile).toHaveAttribute("href", `/u/${WALLET}`);
    expect(within(profile).getByText("0xd590…b82d")).toHaveClass("font-mono");
  });

  it("makes the mobile top bar brand a link home, styled like the sidebar brand", () => {
    renderSidebar(7n);
    const topbarBrand = within(mobileBar()).getByRole("link", { name: "El Club." });
    expect(topbarBrand).toHaveAttribute("href", "/");
    const sidebarBrand = within(desktopBar()).getByRole("link", { name: "El Club." });
    expect(topbarBrand.className).toContain("font-display");
    expect(topbarBrand.className).toContain("focus-visible:ring-accent");
    expect(sidebarBrand.className).toContain("font-display");
  });

  it("shows Reportes only when the server says the member moderates a visible channel", () => {
    render(<Sidebar perms={7n} wallet={WALLET} canModerate />);
    expect(screen.getByRole("link", { name: "Reportes" })).toHaveAttribute("href", "/moderation/reports");
  });

  it("hides Reportes without the flag, even with global 8 or 512 (the page would be a 404)", () => {
    const { unmount } = renderSidebar(8n);
    expect(screen.queryByRole("link", { name: "Reportes" })).toBeNull();
    unmount();
    renderSidebar(512n);
    expect(screen.queryByRole("link", { name: "Reportes" })).toBeNull();
  });

  it("always links to the guide, right after Tickets", () => {
    renderSidebar(0n);
    const names = within(desktopBar()).getAllByRole("link").map((l) => l.textContent);
    expect(screen.getByRole("link", { name: "Guía" })).toHaveAttribute("href", "/guia");
    expect(names.indexOf("Guía")).toBe(names.indexOf("Tickets") + 1);
  });

  it("always links to the DAO dashboard, right after the guide", () => {
    renderSidebar(0n);
    const names = within(desktopBar()).getAllByRole("link").map((l) => l.textContent);
    expect(screen.getByRole("link", { name: "DAO" })).toHaveAttribute("href", "/dao");
    expect(names.indexOf("DAO")).toBe(names.indexOf("Guía") + 1);
  });

  it("always links to Tickets, with the open count when there are any", () => {
    const { unmount } = renderSidebar(7n);
    expect(screen.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", "/tickets");
    unmount();
    render(<Sidebar perms={7n} wallet={WALLET} openTickets={2} />);
    expect(screen.getByRole("link", { name: "Tickets, 2 abiertos" })).toHaveAttribute("href", "/tickets");
  });

  it("offers sign out", () => {
    renderSidebar(7n);
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("marks only the active link with aria-current=page", () => {
    pathname.value = "/invites";
    renderSidebar(512n);
    expect(screen.getByRole("link", { name: "Invitaciones" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inicio" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Miembros" })).not.toHaveAttribute("aria-current");
  });

  it("Inicio is active on exactly '/'", () => {
    pathname.value = "/";
    renderSidebar(7n);
    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  });

  it("nav links have a >=44px target", () => {
    renderSidebar(512n);
    for (const name of ["Inicio", "Invitaciones", "Miembros"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("min-h-11");
    }
  });

  it("has a labelled primary navigation and a mobile menu trigger", () => {
    renderSidebar(7n);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
  });
});

// RightRail: tests/unit/shell/right-rail.test.tsx
