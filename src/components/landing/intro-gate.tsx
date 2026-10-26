"use client";

import { useEffect, useRef, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { gridFor, markIntroSeen, waveDelays } from "@/lib/landing/intro";

/*
 * First-visit intro of the public home (spec «1. Entrada interactiva», mockup intro-v2 variant C · Ola de giros):
 * sonar rings around the logo → press anywhere → the logo flips like a card → the camera dives into the blue mark →
 * the blue breaks into a grid of tiles that flip away in a wave born where the visitor pressed → the landing.
 *
 * Whether it shows is decided before the first paint by the inline boot script (html[data-intro="on"], see
 * lib/landing/intro.ts). The server always renders the overlay so a first visitor never sees the landing flash before
 * hydration; CSS keeps it hidden unless html[data-intro] is set, and after hydration the component reads that attribute
 * and renders nothing when it is unset.
 */

const LOGO_1 = "/brand/logo/elclub-logo-1.svg";
const LOGO_2 = "/brand/logo/elclub-logo-2.svg";

/** The blue mark inside the 800×800 logo: 272×332, centred at 43.6% 49.9% of the tile. */
const MARK = { w: 272 / 800, h: 332 / 800, cx: 0.436, cy: 0.499 };
/** The wave crosses the screen in about this long, whatever its size (the mockup's pace on a small stage). */
const WAVE_SPAN_MS = 1000;

const html = () => document.documentElement;

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(html(), { attributes: true, attributeFilter: ["data-intro"] });
  return () => mo.disconnect();
}
const isShown = () => html().hasAttribute("data-intro");
const serverShown = () => true;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function token(name: string): string {
  return getComputedStyle(html()).getPropertyValue(name).trim() || `var(${name})`;
}

/** Ends the intro: unlocks scroll (the attribute goes), unmounts the overlay and hands focus to the landing. */
function finish() {
  delete html().dataset.intro;
  document.getElementById("main")?.focus({ preventScroll: true });
}

export function IntroGate({ lang }: { lang: Lang }) {
  const shown = useSyncExternalStore(subscribe, isShown, serverShown);
  const t = getDictionary(lang).footer;
  const started = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLImageElement>(null);
  const backRef = useRef<HTMLImageElement>(null);
  const blueRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef<HTMLAnchorElement>(null);

  // Focus stays inside the gate while it covers the page: the first Tab lands on the button (nothing is focused on show,
  // so mouse and touch visitors see only the logo), then Tab and Shift+Tab cycle button ↔ «Saltar».
  useEffect(() => {
    if (!shown) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Tab" || !overlayRef.current) return;
      e.preventDefault();
      const inside = overlayRef.current.contains(document.activeElement);
      (inside && document.activeElement === buttonRef.current ? skipRef.current : buttonRef.current)?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown]);

  if (!shown) return null;

  async function play(origin: { x: number; y: number }) {
    const overlay = overlayRef.current;
    const flip = flipRef.current;
    if (!overlay || !flip || typeof flip.animate !== "function") return finish();
    overlay.dataset.playing = "";

    // Flip: logo 1 turns like a card and shows logo 2 on its back.
    const flipping = flip.animate(
      [
        { transform: "rotateY(0deg) scale(1)" },
        { transform: "rotateY(90deg) scale(1.12)", offset: 0.5 },
        { transform: "rotateY(180deg) scale(1)" },
      ],
      { duration: 520, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" },
    );
    await flipping.finished;
    // Settle on logo 2 unrotated, so the zoom maths is plain.
    if (frontRef.current) frontRef.current.style.visibility = "hidden";
    if (backRef.current) backRef.current.style.transform = "none";
    flipping.cancel();

    // Zoom into the blue mark until it covers the screen.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = flip.getBoundingClientRect();
    const markW = r.width * MARK.w;
    const markH = r.height * MARK.h;
    const scale = markW > 0 && markH > 0 ? Math.max(vw / markW, vh / markH) * 1.6 : 1;
    const dx = vw / 2 - (r.left + r.width * MARK.cx);
    const dy = vh / 2 - (r.top + r.height * MARK.cy);
    flip.style.transformOrigin = `${MARK.cx * 100}% ${MARK.cy * 100}%`;
    await flip.animate([{ transform: "translate(0, 0) scale(1)" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }], {
      duration: 900,
      easing: "cubic-bezier(.75,0,.2,1)",
      fill: "forwards",
    }).finished;

    // The screen is blue: swap the zoomed logo for a flat blue layer.
    if (blueRef.current) blueRef.current.hidden = false;
    if (coverRef.current) coverRef.current.hidden = true;
    await wait(180);

    // The wave: the blue breaks into tiles that flip away from where the visitor pressed.
    html().dataset.intro = "revealing";
    const tiles = tilesRef.current;
    if (!tiles) return finish();
    const g = gridFor(vw, vh);
    const tw = vw / g.cols;
    const th = vh / g.rows;
    const far = Math.max(...[0, vw].flatMap((x) => [0, vh].map((y) => Math.hypot(x - origin.x, y - origin.y))));
    const delays = waveDelays(g, { width: vw, height: vh }, origin, far > 0 ? Math.min(1.6, WAVE_SPAN_MS / far) : 1.6);
    const blue = token("--accent-fill");
    const cerulean = token("--accent");
    const runs: Promise<unknown>[] = [];
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        const tile = document.createElement("div");
        tile.className = "intro-tile";
        Object.assign(tile.style, {
          left: `${col * tw}px`,
          top: `${row * th}px`,
          width: `${Math.ceil(tw) + 1}px`,
          height: `${Math.ceil(th) + 1}px`,
        });
        tiles.appendChild(tile);
        const cx = col * tw + tw / 2;
        const cy = row * th + th / 2;
        const axis = Math.abs(cx - origin.x) > Math.abs(cy - origin.y) ? "Y" : "X";
        const sign = (axis === "Y" ? cx > origin.x : cy < origin.y) ? 1 : -1;
        runs.push(
          tile.animate(
            [
              { transform: `perspective(500px) rotate${axis}(0deg)`, backgroundColor: blue },
              { transform: `perspective(500px) rotate${axis}(${sign * 70}deg)`, backgroundColor: cerulean, offset: 0.45 },
              { transform: `perspective(500px) rotate${axis}(${sign * 180}deg)`, backgroundColor: cerulean, opacity: 0 },
            ],
            { duration: 620, delay: delays[row * g.cols + col], easing: "cubic-bezier(.45,0,.3,1)", fill: "forwards" },
          ).finished,
        );
      }
    }
    if (blueRef.current) blueRef.current.hidden = true;
    await Promise.all(runs);
    finish();
  }

  function start(origin: { x: number; y: number }) {
    if (started.current) return;
    started.current = true;
    markIntroSeen();
    play(origin).catch(finish);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as Element).closest("a")) return;
    start({ x: e.clientX, y: e.clientY });
  }

  // Click covers the keyboard (Enter/Space on the button: detail 0, the wave starts at its centre).
  function onClick(e: MouseEvent<HTMLButtonElement>) {
    if (e.detail === 0) {
      const r = e.currentTarget.getBoundingClientRect();
      start({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    } else start({ x: e.clientX, y: e.clientY });
  }

  // «Saltar»: straight to the landing, no animation.
  function onSkip(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    started.current = true;
    markIntroSeen();
    finish();
  }

  return (
    <div data-intro-overlay="" ref={overlayRef} onPointerDown={onPointerDown}>
      <div className="intro-cover" ref={coverRef}>
        <span className="intro-ring" aria-hidden="true" />
        <span className="intro-ring" aria-hidden="true" />
        <span className="intro-ring" aria-hidden="true" />
        <div className="intro-flip" ref={flipRef} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={frontRef} className="intro-face" src={LOGO_1} alt="" width={220} height={220} draggable={false} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={backRef} className="intro-face intro-back" src={LOGO_2} alt="" width={220} height={220} draggable={false} />
        </div>
      </div>
      <div className="intro-blue" ref={blueRef} hidden />
      <div className="intro-tiles" ref={tilesRef} aria-hidden="true" />
      <button ref={buttonRef} type="button" aria-label={t.enter} className="intro-hit" onClick={onClick} />
      <a
        ref={skipRef}
        href="#main"
        onClick={onSkip}
        className="sr-only z-10 self-start justify-self-start focus:not-sr-only focus:m-4 focus:rounded-[var(--radius-control)] focus:bg-accent-fill focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fill-fg focus:outline-none"
      >
        {t.skip}
      </a>
    </div>
  );
}
