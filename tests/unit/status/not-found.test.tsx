import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("src/app/not-found.tsx", () => {
  it("is noindex and picks the variant from x-pathname", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ headers: async () => new Headers({ "x-pathname": "/foro/c/nada" }) }));
    const page = await import("@/app/not-found");
    expect((page.metadata.robots as { index: boolean }).index).toBe(false);
    const { NotFoundFromRequest } = await import("@/components/status/not-found-view");
    render(await NotFoundFromRequest());
    expect(screen.getByRole("heading", { level: 1, name: es.notFoundForoTitle })).toBeInTheDocument();
    vi.doUnmock("next/headers");
  });
});
