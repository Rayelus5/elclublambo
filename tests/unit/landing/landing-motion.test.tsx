import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Landing } from "@/components/landing/landing";

// Own file: Motion reads prefers-reduced-motion once per module context (landing.test.tsx runs with it on).
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.IntersectionObserver ??= class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

describe("Landing with motion allowed", () => {
  it("keeps off-screen blocks waiting for their reveal (so the reduced-motion check has teeth)", async () => {
    const { container } = render(<Landing lang="es" />);
    await waitFor(() => {
      const hidden = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) => el.style.opacity === "0");
      expect(hidden.length).toBeGreaterThan(0);
    });
  });
});
