import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { IntroPathGuard } from "@/components/landing/intro-path-guard";

const html = document.documentElement;

function go(path: string) {
  pathname = path;
  window.history.pushState({}, "", path);
}

afterEach(() => {
  delete html.dataset.intro;
  delete window.__elclubIntroOff;
  go("/");
});

describe("IntroPathGuard", () => {
  it("keeps the intro on the home pages, also under StrictMode", () => {
    for (const path of ["/", "/en", "/en/"]) {
      go(path);
      html.dataset.intro = "on";
      const { unmount } = render(
        <StrictMode>
          <IntroPathGuard />
        </StrictMode>,
      );
      expect(html.dataset.intro).toBe("on");
      unmount();
    }
  });

  it("clears html[data-intro] (and with it the scroll lock) once the visitor leaves the home without passing the gate", () => {
    go("/");
    html.dataset.intro = "on";
    const { rerender } = render(<IntroPathGuard />);
    expect(html.dataset.intro).toBe("on");
    const off = vi.fn();
    window.__elclubIntroOff = off;
    go("/herramientas");
    rerender(<IntroPathGuard />);
    expect(html.dataset.intro).toBeUndefined();
    expect(off).toHaveBeenCalledOnce();
  });

  it("clears a stale attribute on a page outside the home on mount", () => {
    go("/foro");
    html.dataset.intro = "revealing";
    render(<IntroPathGuard />);
    expect(html.dataset.intro).toBeUndefined();
  });
});
