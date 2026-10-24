import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
/** Staff-only sections (Miembros, Reportes, Ajustes) sit in the «Más» menu of the desktop top bar. */
const openMore = async () => {
  await userEvent.setup().click(within(desktopBar()).getByRole("button", { name: "Más" }));
};

describe("Sidebar without the legacy DAO (P1)", () => {
  it("has no DAO entry in the desktop bar or the drawer", () => {
    render(<Sidebar perms={7n} wallet={WALLET} />);
    expect(screen.queryByRole("link", { name: "DAO" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Mercado" }).length).toBeGreaterThan(0);
  });
});

describe("Sidebar", () => {
  it("shows a Buscar button in the desktop top bar and in the mobile top bar", () => {
    renderSidebar(7n);
    expect(within(desktopBar()).getByRole("button", { name: /^Buscar/ })).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    expect(within(mobileBar()).getByRole("button", { name: "Buscar" })).toBeInTheDocument();
  });

  it("puts the primary navigation in the desktop top bar, horizontally, with the staff sections under «Más»", async () => {
    renderSidebar(512n);
    const nav = within(desktopBar()).getByRole("navigation", { name: "Principal" });
    expect(nav.querySelector("ul")).toHaveClass("flex-row");
    for (const name of ["Inicio", "Tickets", "Invitaciones"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole("link", { name: "Miembros" })).toBeNull();
    await openMore();
    expect(await screen.findByRole("menuitem", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Ajustes" })).toBeInTheDocument();
  });

  it("has no «Más» menu for a member without staff sections", () => {
    renderSidebar(16n);
    expect(within(desktopBar()).queryByRole("button", { name: "Más" })).toBeNull();
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

  it("shows both with ADMINISTRATOR (512)", async () => {
    renderSidebar(512n);
    expect(screen.getByRole("link", { name: "Invitaciones" })).toBeInTheDocument();
    await openMore();
    expect(await screen.findByRole("menuitem", { name: "Miembros" })).toHaveAttribute("href", "/admin/members");
  });

  it("shows Miembros with bit 32 (and no Invitaciones)", async () => {
    renderSidebar(32n);
    await openMore();
    expect(await screen.findByRole("menuitem", { name: "Miembros" })).toBeInTheDocument();
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

  it("shows Reportes only when the server says the member moderates a visible channel", async () => {
    render(<Sidebar perms={7n} wallet={WALLET} canModerate />);
    await openMore();
    expect(await screen.findByRole("menuitem", { name: "Reportes" })).toHaveAttribute("href", "/moderation/reports");
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

  it("always links to Donar, right after the guide", () => {
    renderSidebar(0n);
    const names = within(desktopBar()).getAllByRole("link").map((l) => l.textContent);
    expect(within(desktopBar()).getByRole("link", { name: "Donar" })).toHaveAttribute("href", "/donar");
    expect(names.indexOf("Donar")).toBe(names.indexOf("Guía") + 1);
  });

  it("always links to Mercado, right after Donar (the drawer shares sections())", () => {
    renderSidebar(0n);
    const names = within(desktopBar()).getAllByRole("link").map((l) => l.textContent);
    expect(within(desktopBar()).getByRole("link", { name: "Mercado" })).toHaveAttribute("href", "/mercado");
    expect(names.indexOf("Mercado")).toBe(names.indexOf("Donar") + 1);
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

  it("marks only the active link with aria-current=page", async () => {
    pathname.value = "/invites";
    renderSidebar(512n);
    expect(screen.getByRole("link", { name: "Invitaciones" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inicio" })).not.toHaveAttribute("aria-current");
    await openMore();
    expect(await screen.findByRole("menuitem", { name: "Miembros" })).not.toHaveAttribute("aria-current");
  });

  it("marks «Más» as the current section while one of its sections is open", () => {
    pathname.value = "/settings/roles";
    renderSidebar(512n);
    expect(within(desktopBar()).getByRole("button", { name: "Más" })).toHaveClass("border-accent");
  });

  it("Inicio is active on exactly '/'", () => {
    pathname.value = "/";
    renderSidebar(7n);
    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  });

  it("nav links have a >=44px target", () => {
    renderSidebar(512n);
    for (const name of ["Inicio", "Invitaciones"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("min-h-11");
    }
    expect(within(desktopBar()).getByRole("button", { name: "Más" })).toHaveClass("min-h-11", "min-w-11");
  });

  it("has a labelled primary navigation and a mobile menu trigger", () => {
    renderSidebar(7n);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
  });
});

// RightRail: tests/unit/shell/right-rail.test.tsx
