import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/public/tool-grid", async (orig) => ({ ...(await orig<object>()), offTools: async () => new Set() }));

import { FooterNav, PublicFooter } from "@/components/public/public-footer";
import { SOCIAL, SocialLinks } from "@/components/public/social-links";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import { localizedPath } from "@/lib/i18n/routes";

describe("public footer", () => {
  it("links the seven tools, what-is, forum and donate in Spanish", () => {
    render(<FooterNav lang="es" off={new Set()} />);
    const tools = screen.getByRole("navigation", { name: "Herramientas" });
    expect(within(tools).getAllByRole("link")).toHaveLength(7);
    expect(within(tools).getByRole("link", { name: "Calculadora de gas" })).toHaveAttribute("href", localizedPath("es", "gas"));
    expect(screen.getByRole("link", { name: "¿Qué es ElClub.?" })).toHaveAttribute("href", localizedPath("es", "start"));
    expect(screen.getByRole("link", { name: "Foro" })).toHaveAttribute("href", "/foro");
    expect(screen.getByRole("link", { name: "Donar" })).toHaveAttribute("href", localizedPath("es", "donate"));
  });

  it("a switched-off tool and donate are muted text with the unavailable suffix, not links", () => {
    render(<FooterNav lang="en" off={new Set(["gas", "donate"])} />);
    expect(screen.queryByRole("link", { name: en.tools.gas.name })).toBeNull();
    const gas = screen.getByText(en.tools.gas.name, { exact: false });
    expect(gas).toHaveAttribute("aria-disabled", "true");
    expect(gas).toHaveClass("text-fg-muted");
    expect(gas).toHaveTextContent(`(${en.tools.unavailableNow})`);
    expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
    expect(screen.getByText(en.footer.donate, { exact: false })).toHaveAttribute("aria-disabled", "true");
  });

  it("social links open in a new tab, safely, with names", () => {
    render(<SocialLinks lang="es" />);
    for (const [name, href] of [
      [es.footer.x, SOCIAL[0].href],
      [es.footer.youtube, SOCIAL[1].href],
      [es.footer.discord, SOCIAL[2].href],
    ]) {
      const a = screen.getByRole("link", { name });
      expect(a).toHaveAttribute("href", href);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("carries the tagline, builtOn, legal line and rights", () => {
    render(<PublicFooter lang="es" />);
    expect(screen.getByText(es.footer.tagline)).toBeInTheDocument();
    expect(screen.getByText(es.footer.builtOn)).toBeInTheDocument();
    expect(screen.getByText(es.footer.rights)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(es.common.noCustody.slice(0, 20)))).toBeInTheDocument();
  });
});
