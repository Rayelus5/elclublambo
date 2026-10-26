import { describe, expect, it } from "vitest";
import {
  INTRO_KEY,
  INTRO_PATHS,
  gridFor,
  introBootScript,
  markIntroSeen,
  shouldShowIntro,
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
  function run(opts: { pathname?: string; stored?: string | null; throws?: boolean; reduce?: boolean }) {
    const documentElement = { dataset: {} as Record<string, string> };
    const localStorage = {
      getItem: (key: string) => {
        if (opts.throws) throw new Error("blocked");
        return key === INTRO_KEY ? (opts.stored ?? null) : null;
      },
    };
    const location = { pathname: opts.pathname ?? "/" };
    const matchMedia = (q: string) => ({ matches: q.includes("reduce") && Boolean(opts.reduce) });
    const fn = new Function("window", "document", "localStorage", "location", "matchMedia", introBootScript());
    expect(() => fn({}, { documentElement }, localStorage, location, matchMedia)).not.toThrow();
    return documentElement.dataset.intro;
  }

  it("shows on / for a first visit", () => {
    expect(run({ pathname: "/" })).toBe("on");
    expect(run({ pathname: "/en/" })).toBe("on");
  });

  it("does not show once the key is set", () => {
    expect(run({ pathname: "/", stored: "1" })).toBeUndefined();
  });

  it("shows, without throwing, when localStorage throws", () => {
    expect(run({ pathname: "/", throws: true })).toBe("on");
  });

  it("does not show off the home pages or with reduced motion", () => {
    expect(run({ pathname: "/herramientas" })).toBeUndefined();
    expect(run({ pathname: "/", reduce: true })).toBeUndefined();
  });
});
