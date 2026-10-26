import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTRO_KEY,
  INTRO_PATHS,
  gridFor,
  introBootScript,
  markIntroSeen,
  shouldShowIntro,
  takeEarlyTap,
  waveDelays,
} from "@/lib/landing/intro";

describe("shouldShowIntro", () => {
  it("shows on the home pages for a first visit with motion allowed", () => {
    expect(shouldShowIntro({ pathname: "/", seen: false, reducedMotion: false })).toBe(true);
    expect(shouldShowIntro({ pathname: "/en/", seen: false, reducedMotion: false })).toBe(true);
    expect(INTRO_PATHS).toEqual(["/", "/en"]);
  });

  it("does not show once seen, with reduced motion, or off the home pages", () => {
    expect(shouldShowIntro({ pathname: "/en", seen: true, reducedMotion: false })).toBe(false);
    expect(shouldShowIntro({ pathname: "/", seen: false, reducedMotion: true })).toBe(false);
    expect(shouldShowIntro({ pathname: "/herramientas", seen: false, reducedMotion: false })).toBe(false);
  });
});

describe("gridFor", () => {
  it("uses 12 columns on desktop and 6 on mobile, with rows following the aspect ratio", () => {
    expect(gridFor(1440, 900)).toEqual({ cols: 12, rows: 8 });
    expect(gridFor(375, 812)).toEqual({ cols: 6, rows: 13 });
    expect(gridFor(2000, 10)).toEqual({ cols: 12, rows: 1 });
  });
});

describe("waveDelays", () => {
  it("delays each tile by its centre's distance to the origin, row-major", () => {
    const d = waveDelays({ cols: 2, rows: 1 }, { width: 200, height: 100 }, { x: 0, y: 50 }, 1);
    expect(d).toEqual([50, 150]);
  });

  it("defaults to 1.6 ms per pixel", () => {
    expect(waveDelays({ cols: 1, rows: 1 }, { width: 100, height: 100 }, { x: 50, y: 0 })).toEqual([80]);
  });
});

describe("markIntroSeen", () => {
  it("writes the key", () => {
    const calls: [string, string][] = [];
    markIntroSeen({ setItem: (k, v) => void calls.push([k, v]) });
    expect(calls).toEqual([[INTRO_KEY, "1"]]);
  });

  it("swallows a throwing storage", () => {
    expect(() =>
      markIntroSeen({
        setItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});

describe("introBootScript", () => {
  type Listener = (e: unknown) => void;
  function run(opts: { pathname?: string; stored?: string | null; throws?: boolean; reduce?: boolean }) {
    const documentElement = { dataset: {} as Record<string, string> };
    const store: Record<string, string> = {};
    const localStorage = {
      getItem: (key: string) => {
        if (opts.throws) throw new Error("blocked");
        return key === INTRO_KEY ? (opts.stored ?? null) : null;
      },
      setItem: (key: string, value: string) => {
        if (opts.throws) throw new Error("blocked");
        store[key] = value;
      },
    };
    const listeners: { type: string; fn: Listener; capture: unknown }[] = [];
    const document = {
      documentElement,
      addEventListener: (type: string, fn: Listener, capture: unknown) => listeners.push({ type, fn, capture }),
      removeEventListener: (type: string, fn: Listener) => {
        const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
    const window: { __elclubIntro?: { x: number; y: number }; __elclubIntroOff?: () => void } = {};
    const location = { pathname: opts.pathname ?? "/" };
    const matchMedia = (q: string) => ({ matches: q.includes("reduce") && Boolean(opts.reduce) });
    const fn = new Function("window", "document", "localStorage", "location", "matchMedia", introBootScript());
    expect(() => fn(window, document, localStorage, location, matchMedia)).not.toThrow();
    /** A pointerdown as the browser would dispatch it, its target inside (or outside) the overlay, or inside a link. */
    const press = (e: { button?: number; x?: number; y?: number; inOverlay?: boolean; inLink?: boolean }) => {
      const target = {
        closest: (sel: string) =>
          (sel === "[data-intro-overlay]" && e.inOverlay !== false) || (sel === "a" && e.inLink) ? {} : null,
      };
      for (const l of [...listeners]) {
        if (l.type === "pointerdown") l.fn({ button: e.button ?? 0, clientX: e.x ?? 0, clientY: e.y ?? 0, target });
      }
    };
    return { intro: documentElement.dataset.intro, store, listeners, window, press };
  }

  it("shows on / for a first visit", () => {
    expect(run({ pathname: "/" }).intro).toBe("on");
    expect(run({ pathname: "/en/" }).intro).toBe("on");
  });

  it("does not show once the key is set", () => {
    expect(run({ pathname: "/", stored: "1" }).intro).toBeUndefined();
  });

  it("shows, without throwing, when localStorage throws", () => {
    expect(run({ pathname: "/", throws: true }).intro).toBe("on");
  });

  it("does not show off the home pages or with reduced motion", () => {
    expect(run({ pathname: "/herramientas" }).intro).toBeUndefined();
    expect(run({ pathname: "/", reduce: true }).intro).toBeUndefined();
  });

  it("with reduced motion the visit counts as made (spec: «la visita cuenta como hecha»)", () => {
    expect(run({ pathname: "/", reduce: true }).store).toEqual({ [INTRO_KEY]: "1" });
    expect(run({ pathname: "/herramientas", reduce: true }).store).toEqual({});
    expect(() => run({ pathname: "/", reduce: true, throws: true })).not.toThrow();
  });

  it("listens for an early tap only when the intro shows", () => {
    expect(run({ pathname: "/" }).listeners).toEqual([expect.objectContaining({ type: "pointerdown", capture: true })]);
    expect(run({ pathname: "/", stored: "1" }).listeners).toEqual([]);
    expect(run({ pathname: "/", reduce: true }).listeners).toEqual([]);
    expect(run({ pathname: "/herramientas" }).listeners).toEqual([]);
  });

  it("records a primary press on the overlay before hydration, then stops listening", () => {
    const r = run({ pathname: "/" });
    r.press({ x: 120, y: 340 });
    expect(r.window.__elclubIntro).toEqual({ x: 120, y: 340 });
    expect(r.listeners).toEqual([]);
  });

  it("ignores a secondary button, a press outside the overlay and a press on a link («Saltar»)", () => {
    const r = run({ pathname: "/" });
    r.press({ button: 2 });
    r.press({ inOverlay: false });
    r.press({ inLink: true });
    expect(r.window.__elclubIntro).toBeUndefined();
    expect(r.listeners).toHaveLength(1);
  });

  it("exposes __elclubIntroOff to detach the listener once the gate hydrates", () => {
    const r = run({ pathname: "/" });
    r.window.__elclubIntroOff?.();
    expect(r.listeners).toEqual([]);
    r.press({});
    expect(r.window.__elclubIntro).toBeUndefined();
  });
});

describe("takeEarlyTap", () => {
  afterEach(() => {
    delete window.__elclubIntro;
    delete window.__elclubIntroOff;
  });

  it("detaches the boot listener and hands over the recorded tap, once", () => {
    const off = vi.fn();
    window.__elclubIntroOff = off;
    window.__elclubIntro = { x: 5, y: 6 };
    expect(takeEarlyTap()).toEqual({ x: 5, y: 6 });
    expect(off).toHaveBeenCalledOnce();
    expect(window.__elclubIntro).toBeUndefined();
    expect(window.__elclubIntroOff).toBeUndefined();
    expect(takeEarlyTap()).toBeNull();
  });

  it("is null without a recorded tap", () => {
    expect(takeEarlyTap()).toBeNull();
  });
});
