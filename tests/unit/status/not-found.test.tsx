import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { NotFoundView, notFoundVariant } from "@/components/status/not-found-view";
import { getDictionary } from "@/lib/i18n";

const es = getDictionary("es").status;
const en = getDictionary("en").status;

const fills = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.className.toString().split(/\s+/).includes("bg-accent-fill"));

describe("notFoundVariant (A-R14)", () => {
  it.each([
    ["/en/x", "en"],
    ["/en", "en"],
    ["/en?x=1", "en"],
    ["/foro/c/x", "foro"],
    ["/foro", "foro"],
    ["/x", "es"],
    ["/herramientas/nada", "es"],
    ["/enigma", "es"],
    ["/forografia", "es"],
    [null, "es"],
  ] as const)("%s → %s", (path, variant) => {
    expect(notFoundVariant(path)).toBe(variant);
  });
});

describe("NotFoundView", () => {
  it("es: title, text, back home to / as the only fill, see tools as outline", () => {
    const { container } = render(<NotFoundView variant="es" />);
    expect(screen.getByRole("heading", { level: 1, name: es.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByText(es.notFoundText)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: es.backHome })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: es.seeTools })).toHaveAttribute("href", "/herramientas");
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(fills(container)).toHaveLength(1);
    expect(container.querySelector("main")?.getAttribute("lang")).toBe("es");
  });

  it("en: back home to /en", () => {
    const { container } = render(<NotFoundView variant="en" />);
    expect(screen.getByRole("heading", { level: 1, name: en.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/en");
    expect(screen.getByRole("link", { name: en.seeTools })).toHaveAttribute("href", "/en/tools");
    expect(fills(container)).toHaveLength(1);
    expect(container.querySelector("main")?.getAttribute("lang")).toBe("en");
  });

  it("foro: Spanish, «Volver al foro» to /foro as the only fill", () => {
    const { container } = render(<NotFoundView variant="foro" />);
    expect(screen.getByRole("heading", { level: 1, name: es.notFoundForoTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al foro" })).toHaveAttribute("href", "/foro");
    expect(fills(container)).toHaveLength(1);
  });
});

// The 404 is static (served by the CDN, no function per 404): its three variants are in the HTML and the URL picks one
// before the first paint (html[data-nf], set by the inline boot script, or by NotFoundVariantSync on a client navigation).
describe("src/app/not-found.tsx", () => {
  it("is noindex, never reads the request, and holds the three variants", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      headers: async () => {
        throw new Error("the 404 must not read the request");
      },
    }));
    const page = await import("@/app/not-found");
    expect((page.metadata.robots as { index: boolean }).index).toBe(false);
    const { container } = render(page.default());
    expect([...container.querySelectorAll("[data-nf-variant]")].map((el) => el.getAttribute("data-nf-variant"))).toEqual(["es", "en", "foro"]);
    expect(container.querySelector('[data-nf-variant="en"] h1')?.textContent).toBe(en.notFoundTitle);
    expect(container.querySelector('[data-nf-variant="foro"] h1')?.textContent).toBe(es.notFoundForoTitle);
    vi.doUnmock("next/headers");
  });
});

describe("notFoundBootScript", () => {
  it.each(["/en/x", "/en", "/foro/c/x", "/foro", "/x", "/herramientas/nada", "/enigma", "/forografia", "/"])(
    "%s: sets html[data-nf] to the same variant as notFoundVariant",
    async (path) => {
      const { notFoundBootScript } = await import("@/components/status/not-found-view");
      window.history.pushState({}, "", path);
      delete document.documentElement.dataset.nf;
      new Function(notFoundBootScript())();
      expect(document.documentElement.dataset.nf).toBe(notFoundVariant(path));
    },
  );
});

describe("NotFoundVariantSync", () => {
  it("follows a client navigation from one 404 to another in a different section (same instance)", async () => {
    const { NotFoundVariantSync } = await import("@/components/status/not-found-variant-sync");
    window.history.pushState({}, "", "/en/x");
    nav.pathname = "/en/x";
    const { rerender } = render(<NotFoundVariantSync />);
    expect(document.documentElement.dataset.nf).toBe("en");
    window.history.pushState({}, "", "/foro/y");
    nav.pathname = "/foro/y";
    rerender(<NotFoundVariantSync />);
    expect(document.documentElement.dataset.nf).toBe("foro");
  });

  it("sets the variant on a client navigation (the inline script is inert there) and clears it when the 404 goes", async () => {
    const { NotFoundVariantSync } = await import("@/components/status/not-found-variant-sync");
    window.history.pushState({}, "", "/en/tools/giveaways/x");
    document.documentElement.dataset.nf = "foro";
    const { unmount } = render(<NotFoundVariantSync />);
    expect(document.documentElement.dataset.nf).toBe("en");
    unmount();
    expect(document.documentElement.dataset.nf).toBeUndefined();
  });
});
