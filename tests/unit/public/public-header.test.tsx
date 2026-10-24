import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => null }));

import { PublicHeader } from "@/components/public/public-header";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const hrefs = () => ({
  es: screen.getByRole("link", { name: "es" }).getAttribute("href"),
  en: screen.getByRole("link", { name: "en" }).getAttribute("href"),
});

beforeEach(() => (pathname.value = "/"));

describe("PublicHeader language switcher", () => {
  it.each([
    ["/es/tools", "/herramientas", "/en/tools"],
    ["/herramientas", "/herramientas", "/en/tools"],
    [`/es/tools/giveaways/${ID}`, `/herramientas/sorteos/${ID}`, `/en/tools/giveaways/${ID}`],
  ])("%s -> es %s, en %s", (path, es, en) => {
    pathname.value = path;
    render(<PublicHeader lang="es" session={null} />);
    expect(hrefs()).toEqual({ es, en });
  });

  it("English internal path /en/tools", () => {
    pathname.value = "/en/tools";
    render(<PublicHeader lang="en" session={null} />);
    expect(hrefs()).toEqual({ es: "/herramientas", en: "/en/tools" });
  });
});
