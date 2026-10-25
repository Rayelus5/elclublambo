import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/" }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value, useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => null }));
vi.mock("wagmi", () => ({ useDisconnect: () => ({ disconnect: vi.fn() }) }));

import { PublicHeader } from "@/components/public/public-header";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const hrefs = () => ({
  es: screen.getByRole("link", { name: "es" }).getAttribute("href"),
  en: screen.getByRole("link", { name: "en" }).getAttribute("href"),
});

beforeEach(() => {
  pathname.value = "/";
  push.mockReset();
  window.history.replaceState(null, "", "/");
});

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

  it("keeps the query of the page: /herramientas/avales?address=0x… -> /en/tools/vouches?address=0x… (P5)", () => {
    const addr = "0x3333333333333333333333333333333333333333";
    pathname.value = "/herramientas/avales";
    window.history.replaceState(null, "", `/herramientas/avales?address=${addr}`);
    render(<PublicHeader lang="es" session={null} />);
    expect(hrefs()).toEqual({ es: `/herramientas/avales?address=${addr}`, en: `/en/tools/vouches?address=${addr}` });
  });

  it("a query that changed on the same path since the render is the one the click carries", () => {
    pathname.value = "/herramientas/avales";
    window.history.replaceState(null, "", "/herramientas/avales?address=old");
    render(<PublicHeader lang="es" session={null} />);
    window.history.replaceState(null, "", "/herramientas/avales?address=new");
    fireEvent.click(screen.getByRole("link", { name: "en" }));
    expect(push).toHaveBeenCalledWith("/en/tools/vouches?address=new");
  });

  it("without a query the link navigates as it is", () => {
    pathname.value = "/herramientas";
    render(<PublicHeader lang="es" session={null} />);
    expect(hrefs().en).toBe("/en/tools");
    fireEvent.click(screen.getByRole("link", { name: "en" }));
    expect(push).not.toHaveBeenCalled();
  });
});
