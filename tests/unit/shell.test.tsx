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
import { RightRail } from "@/components/shell/right-rail";

const WALLET = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as const;

beforeEach(() => {
  pathname.value = "/";
});

function renderSidebar(perms: bigint) {
  return render(<Sidebar perms={perms} wallet={WALLET} />);
}

describe("Sidebar", () => {
  it("shows a Buscar button in the sidebar and in the mobile top bar", () => {
    renderSidebar(7n);
    expect(screen.getAllByRole("button", { name: /^Buscar/ })).toHaveLength(2);
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
    const topbarBrand = within(screen.getByRole("banner")).getByRole("link", { name: "El Club." });
    expect(topbarBrand).toHaveAttribute("href", "/");
    const sidebarBrand = within(screen.getByRole("complementary")).getByRole("link", { name: "El Club." });
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

describe("RightRail", () => {
  it("shows the Próximamente placeholder", () => {
    render(<RightRail />);
    expect(screen.getByText("Próximamente")).toBeInTheDocument();
  });
});
