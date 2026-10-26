import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

import { MaintenanceBanner } from "@/components/status/maintenance-banner";
import { getDictionary } from "@/lib/i18n";

const clearCookie = () => (document.cookie = "elclub-mnt=; Max-Age=0; path=/");

afterEach(() => {
  clearCookie();
  document.documentElement.style.removeProperty("--mnt-banner-h");
});

describe("MaintenanceBanner (A-R15)", () => {
  it("with the cookie: a fixed status strip in Spanish on /herramientas", () => {
    document.cookie = "elclub-mnt=1; path=/";
    pathname.value = "/herramientas";
    render(<MaintenanceBanner />);
    const strip = screen.getByRole("status");
    expect(strip).toHaveTextContent(getDictionary("es").status.banner);
    expect(strip.className).toContain("fixed");
    expect(strip.className).toContain("bg-surface-2");
    expect(strip.className).toContain("border-accent");
    expect(strip.getAttribute("lang")).toBe("es");
  });

  it("with the cookie: English on /en/tools", () => {
    document.cookie = "elclub-mnt=1; path=/";
    pathname.value = "/en/tools";
    render(<MaintenanceBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(getDictionary("en").status.banner);
  });

  it("reserves its height on the page while it is shown", () => {
    document.cookie = "elclub-mnt=1; path=/";
    pathname.value = "/";
    const { unmount } = render(<MaintenanceBanner />);
    expect(document.documentElement.style.getPropertyValue("--mnt-banner-h")).not.toBe("");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--mnt-banner-h")).toBe("");
  });

  it("re-reads the cookie when the route changes", () => {
    pathname.value = "/";
    const { rerender } = render(<MaintenanceBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    document.cookie = "elclub-mnt=1; path=/";
    pathname.value = "/herramientas";
    rerender(<MaintenanceBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("without the cookie: nothing", () => {
    pathname.value = "/herramientas";
    const { container } = render(<MaintenanceBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
