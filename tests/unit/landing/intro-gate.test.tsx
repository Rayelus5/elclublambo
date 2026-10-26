import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntroGate } from "@/components/landing/intro-gate";
import { INTRO_KEY } from "@/lib/landing/intro";

const html = document.documentElement;
const originalAnimate = Element.prototype.animate;

function Page() {
  return (
    <>
      <IntroGate lang="es" />
      <main id="main" tabIndex={-1}>
        landing
      </main>
    </>
  );
}

/** Every value data-intro takes, in order (undefined = removed). */
function watchIntro() {
  const seen: (string | undefined)[] = [];
  const mo = new MutationObserver(() => seen.push(html.dataset.intro));
  mo.observe(html, { attributes: true, attributeFilter: ["data-intro"] });
  return { seen, stop: () => mo.disconnect() };
}

let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  html.dataset.intro = "on";
  Element.prototype.animate = vi.fn(() => ({
    finished: Promise.resolve(),
    cancel() {},
  })) as unknown as typeof Element.prototype.animate;
  setItem = vi.spyOn(Storage.prototype, "setItem");
});

afterEach(() => {
  delete html.dataset.intro;
  Element.prototype.animate = originalAnimate;
  setItem.mockRestore();
  localStorage.clear();
});

async function expectRevealed(watch: ReturnType<typeof watchIntro>) {
  await waitFor(() => expect(html.dataset.intro).toBeUndefined());
  await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  watch.stop();
  expect(watch.seen).toContain("revealing");
  expect(watch.seen.at(-1)).toBeUndefined();
  expect(setItem).toHaveBeenCalledWith(INTRO_KEY, "1");
  expect(document.activeElement).toBe(document.getElementById("main"));
}

describe("IntroGate", () => {
  it("names the full-screen button for assistive tech", () => {
    render(<Page />);
    expect(screen.getByRole("button", { name: "Entrar en ElClub." })).toBeInTheDocument();
  });

  it("plays and reveals the landing on click", async () => {
    render(<Page />);
    const watch = watchIntro();
    fireEvent.click(screen.getByRole("button", { name: "Entrar en ElClub." }));
    await expectRevealed(watch);
  });

  it("focuses nothing on show; Tab lands on the button and cycles button and «Saltar»", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const button = screen.getByRole("button", { name: "Entrar en ElClub." });
    const skip = screen.getByRole("link", { name: "Saltar" });
    expect(document.activeElement).not.toBe(button);
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.tab();
    expect(document.activeElement).toBe(skip);
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(skip);
  });

  it("plays on Enter once Tab has focused the button", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const watch = watchIntro();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Entrar en ElClub." }));
    await user.keyboard("{Enter}");
    await expectRevealed(watch);
  });

  it("reveals without animation when the Web Animations API is missing", async () => {
    // @ts-expect-error simulating an old browser
    delete Element.prototype.animate;
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Entrar en ElClub." }));
    await waitFor(() => expect(html.dataset.intro).toBeUndefined());
    expect(setItem).toHaveBeenCalledWith(INTRO_KEY, "1");
  });

  it("skips instantly from the «Saltar» link", async () => {
    render(<Page />);
    act(() => {
      fireEvent.click(screen.getByRole("link", { name: "Saltar" }));
    });
    expect(html.dataset.intro).toBeUndefined();
    expect(setItem).toHaveBeenCalledWith(INTRO_KEY, "1");
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  it("«Saltar» is a neutral outlined control, 44 px tall, with the focus ring: the logo stays the only blue fill", () => {
    render(<Page />);
    const cls = screen.getByRole("link", { name: "Saltar" }).className.split(/\s+/);
    expect(cls.some((c) => c.includes("accent-fill"))).toBe(false);
    for (const c of ["focus:min-h-11", "focus:border", "focus:border-border-strong", "focus:bg-bg", "focus:text-fg", "focus:ring-2", "focus:ring-accent"]) {
      expect(cls).toContain(c);
    }
  });

  it("renders nothing interactive when data-intro is unset", () => {
    delete html.dataset.intro;
    render(<Page />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
