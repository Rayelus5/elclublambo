import { act, fireEvent, render, screen } from "@testing-library/react";
import { useInsertionEffect } from "react";
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

/** As Next's HistoryUpdater: the URL is written in an insertion effect, after the new page has rendered. */
function HistoryUpdater({ url }: { url: string }) {
  useInsertionEffect(() => {
    window.history.pushState(null, "", url);
  }, [url]);
  return null;
}

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

  it("a soft navigation to a page without a query drops the old query from the links (URL written after the render)", () => {
    pathname.value = "/herramientas/avales";
    window.history.replaceState(null, "", "/herramientas/avales?address=old");
    const view = render(
      <>
        <PublicHeader lang="es" session={null} />
        <HistoryUpdater url="/herramientas/avales?address=old" />
      </>,
    );
    expect(hrefs().en).toBe("/en/tools/vouches?address=old");
    pathname.value = "/herramientas";
    view.rerender(
      <>
        <PublicHeader lang="es" session={null} />
        <HistoryUpdater url="/herramientas" />
      </>,
    );
    expect(hrefs()).toEqual({ es: "/herramientas", en: "/en/tools" });
  });

  it("back / forward (popstate) re-reads the query", async () => {
    pathname.value = "/herramientas/avales";
    window.history.replaceState(null, "", "/herramientas/avales?address=a");
    render(<PublicHeader lang="es" session={null} />);
    await act(async () => {
      window.history.replaceState(null, "", "/herramientas/avales?address=b");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(hrefs().en).toBe("/en/tools/vouches?address=b");
  });

  it("a query-only change on the same path is heard through the Navigation API where it exists", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
    try {
      pathname.value = "/herramientas/avales";
      window.history.replaceState(null, "", "/herramientas/avales?address=a");
      render(<PublicHeader lang="es" session={null} />);
      await act(async () => {
        window.history.replaceState(null, "", "/herramientas/avales?address=c");
        navigation.dispatchEvent(new Event("currententrychange"));
      });
      expect(hrefs().en).toBe("/en/tools/vouches?address=c");
    } finally {
      delete (window as { navigation?: unknown }).navigation;
    }
  });

  it("Chrome fires currententrychange inside Next's insertion effect: the update waits until after the commit", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    function NavigatingUpdater({ url }: { url: string }) {
      useInsertionEffect(() => {
        window.history.pushState(null, "", url);
        navigation.dispatchEvent(new Event("currententrychange"));
      }, [url]);
      return null;
    }
    try {
      pathname.value = "/herramientas/avales";
      window.history.replaceState(null, "", "/herramientas/avales?address=a");
      const view = render(
        <>
          <PublicHeader lang="es" session={null} />
          <NavigatingUpdater url="/herramientas/avales?address=a" />
        </>,
      );
      await act(async () => {
        view.rerender(
          <>
            <PublicHeader lang="es" session={null} />
            <NavigatingUpdater url="/herramientas/avales?address=d" />
          </>,
        );
      });
      expect(hrefs().en).toBe("/en/tools/vouches?address=d");
      expect(error.mock.calls.flat().join(" ")).not.toMatch(/useInsertionEffect must not schedule updates/);
    } finally {
      error.mockRestore();
      delete (window as { navigation?: unknown }).navigation;
    }
  });
});
