# Landing: entrada interactiva, textos y footer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the public site, rewrite the titles in ES/EN to the approved copy, add a full public footer, and add the first-visit intro on the home page: square wave, flip, zoom into blue, then a wave of flipping tiles.

**Architecture:**
- **Copy:** dictionary-only changes (`src/lib/i18n/dictionaries/{es,en}.ts`), guarded by a style test over an explicit key list.
- **Footer:** stays a server component in the public layout. Its tool and donate links are read per request inside `<Suspense>` with `offTools()`, and the language links reuse a `LangSwitch` extracted from the header.
- **Intro, before paint:** an inline boot script in the public layout sets `html[data-intro="on"]` before the header or the page paint, only on `/` or `/en`, with JS on, no stored mark and no reduced motion. The overlay markup lives on the home page and is hidden by CSS unless that attribute is set.
- **Intro, on click:** a client `IntroGate` runs the animation with the Web Animations API, stores the mark, and switches the attribute to `revealing`. That un-pauses the hero's existing `animate-start-rise` entrance.

**Tech Stack:** Next.js 16 (cacheComponents, `instant = false` public tree), React 19, Tailwind v4 tokens in `src/app/globals.css`, Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-landing-intro-footer-design.md` (approved; copy table and «Decisiones de construcción» are binding).

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before touching Next APIs.
- Copy style for titles:
  - No `·`, `:`, `—`, `→` or `//`, and no trailing period.
  - The brand "ElClub." keeps its dot.
  - Spanish writes "cripto".
  - The only exception is the exact prefix `ElClub. · ` on the `metaTitle` of `landing` and `start`.
- Palette R2:
  - Base Blue `#0000FF` (`bg-accent-fill`) is the single fill per screen. The footer uses no fill.
  - Cerulean `#3C8AFF` is the accent.
  - Tokens only, no raw hex in components. The intro is the exception, and only through CSS variables in `globals.css`.
- AA: visible focus ring, 44 px targets, 4.5:1 text contrast.
- Never write files with PowerShell `Set-Content`/`Out-File`.
- Never commit `.env*`.
- `pnpm test`, `pnpm test:e2e` and `pnpm db:*` wipe the owner's local DB. Prefer `pnpm vitest run <files>` while iterating, and run the full suites only at the verification steps.
- Git Bash needs `export PATH="$PATH:/c/Windows/System32"` before Playwright.
- Commit messages are in Spanish, conventional style (`feat(landing): …`), ending with the session's Co-Authored-By and Claude-Session lines.

## Review Focus

1. **Returning visitor:** a returning visitor, or a second tab after the first reveal, must never see the overlay, not even for one frame. The boot script runs before the header paints.
2. **Fresh e2e contexts:** every existing e2e spec opens `/` in a fresh browser context. The intro must not block them. A project-wide `storageState` carries the mark, and only the intro spec opts out.
3. **localStorage throws (private mode):** the overlay still shows, the click still reveals, and nothing crashes.
4. **Keyboard:** Tab lands on the full-screen button, whose accessible name is "Entrar en ElClub." / "Enter ElClub.". Enter reveals. A «Saltar» / «Skip» link appears only while focused. Focus ends on `<main>` after the reveal.
5. **Switched-off tool or Donar:** the footer shows it dimmed and without a link, exactly like the hub. The footer fallback while streaming must not 404.

---

### Task 1: Approved copy in ES/EN and the title-style guard

**Files:**
- Modify: `src/lib/i18n/dictionaries/es.ts`, `src/lib/i18n/dictionaries/en.ts` (keys in the spec's table plus a new `footer` section)
- Modify: `src/app/(public)/[lang]/opengraph-image.tsx` (its `alt` repeats the old title)
- Create: `tests/unit/i18n/copy-style.test.ts`
- Modify: tests that assert old copy: `tests/unit/landing/landing.test.tsx`, `tests/unit/start/start-landing.test.tsx`, `e2e/p2-landing.spec.ts`, `e2e/p2-public-account.spec.ts`, `e2e/p2-routing.spec.ts`, `e2e/r1-foro.spec.ts`, `e2e/start-landing.spec.ts`

**Interfaces:**
- Produces: `Dictionary["footer"]`. Tasks 2 and 3 use these exact keys:
  ```ts
  footer: {
    tagline: string; builtOn: string; toolsHeading: string; clubHeading: string;
    whatIs: string; forum: string; donate: string; language: string; social: string;
    x: string; youtube: string; discord: string; rights: string;
    enter: string; skip: string;           // intro button name and skip link (Task 3)
  }
  ```
  - ES: `tagline` "Herramientas cripto y foro privado", `builtOn` "En Base y Arbitrum", `toolsHeading` "Herramientas", `clubHeading` "ElClub.", `whatIs` "¿Qué es ElClub.?", `forum` "Foro", `donate` "Donar", `language` "Idioma", `social` "Redes", `x` "ElClub. en X", `youtube` "ElClub. en YouTube", `discord` "ElClub. en Discord", `rights` "© 2026 ElClub.", `enter` "Entrar en ElClub.", `skip` "Saltar".
  - EN: "Crypto tools and a private forum", "On Base and Arbitrum", "Tools", "ElClub.", "What is ElClub.?", "Forum", "Donate", "Language", "Social", "ElClub. on X", "ElClub. on YouTube", "ElClub. on Discord", "© 2026 ElClub.", "Enter ElClub.", "Skip".

- [ ] **Step 1: Write `tests/unit/i18n/copy-style.test.ts`.**
  - It walks both dictionaries and collects every string under the keys `title`, `kicker`, `metaTitle`, `ogKicker`, `ogFooter`, `ogFoot`, `ogTagline`, `tagline` and `builtOn`, inside the sections `connect giveaways landing tools start checker pay donate vouches approvals multisend gas footer`.
  - It skips the subtrees `start.noise.thread`, `start.noise.chatter`, `start.ticker` and `checker.*.flags`, where `flags` is the alert-name map (lines 643–662 of es.ts; find its exact path).
  - Assertions:
  ```ts
  it.each(cases)("%s: %s is a direct title", (path, text) => {
    const body = /^(landing|start)\.metaTitle$/.test(path) ? text.replace(/^ElClub\. · /, "") : text;
    expect(body).not.toMatch(/[·:—→]|\/\//);
    expect(body.replace(/ElClub\.$/, "ElClub")).not.toMatch(/\.$/);
  });
  it("Spanish says cripto", () => expect(JSON.stringify(es)).not.toMatch(/\bcrypto\b/i));
  it("pins the owner's picks", () => {
    expect(es.landing.hero.title).toBe("Herramientas cripto gratis y seguras");
    expect(en.landing.hero.title).toBe("Free and safe crypto tools");
    expect(es.landing.hero.kicker).toBe("En Base y Arbitrum");
    expect(es.landing.demo.title).toBe("Un sorteo en la blockchain");
    expect(es.landing.networks.title).toBe("Construido en Base y Arbitrum");
    expect(es.landing.club.title).toBe("Un foro privado por invitación");
    expect(es.landing.final.title).toBe("Empieza gratis");
    expect(es.landing.metaTitle).toBe("ElClub. · Herramientas cripto gratis y seguras");
    expect(es.start.hero.tagline).toBe("Foro cripto privado para todos los niveles");
    expect(en.start.hero.tagline).toBe("A private crypto forum for every level");
  });
  ```
  - If the "cripto" assertion hits a legitimate English-only token inside `es` (a URL, a brand), narrow it to the visible copy and say so in the report.

- [ ] **Step 2: Run it and confirm it fails.**
  - Run: `pnpm vitest run tests/unit/i18n/copy-style.test.ts`
  - Expected: FAIL, listing the old titles (the `·`, `:` and final-period cases).

- [ ] **Step 3: Apply the spec's table.** Use every row of «Textos aprobados», both columns, plus the `footer` section above. Then fix any other title the test flags in the same style, and list those extra rewrites in the report. Rows whose «Dónde» names a feature (for example `start (función)`) map to the `title` with that current text; find it by its old ES string.

- [ ] **Step 4: Update the tests that asserted the old copy** (files listed above) to the new strings. Update the OG `alt` to `"ElClub. Herramientas cripto gratis y seguras / Free and safe crypto tools"`.

- [ ] **Step 5: Run it and confirm it passes.**
  - Run: `pnpm vitest run tests/unit/i18n tests/unit/landing tests/unit/start && pnpm typecheck`
  - Expected: PASS (`dictionaries.test.ts` enforces ES/EN key parity, so `footer` must exist in both).

- [ ] **Step 6: Commit** with `feat(copy): títulos directos en la web pública (ES/EN)`.

### Task 2: Full public footer

**Files:**
- Create: `src/components/public/lang-switch.tsx` (moved out of `public-header.tsx`, behaviour unchanged)
- Modify: `src/components/public/public-header.tsx` (use `LangSwitch`)
- Create: `src/components/public/social-links.tsx`
- Modify: `src/components/public/public-footer.tsx`
- Test: `tests/unit/public/public-footer.test.tsx` (new), plus `tests/unit/public/public-header.test.tsx` (must stay green)

**Interfaces:**
- Consumes: `Dictionary["footer"]` (Task 1), `offTools(): Promise<ReadonlySet<ToolKey>>` from `src/components/public/tool-grid.tsx`, `localizedPath`, `switchLang`.
- Produces:
  - `LangSwitch({ lang, className? }: { lang: Lang; className?: string })`, a client component. It renders the ES/EN links exactly as the header does today (keeps the query, `hrefLang`, `aria-current`) inside a `<nav aria-label={t.connect.language}>`.
  - `SocialLinks({ lang })`.
  - `FooterNav({ lang, off }: { lang: Lang; off: ReadonlySet<ToolKey> })`, the pure, testable part.
  - `PublicFooter({ lang })`, which wraps `<Suspense fallback={<FooterNav lang={lang} off={new Set()} />}><FooterNavLive lang={lang} /></Suspense>`.
- `SOCIAL` constant, exported from `social-links.tsx`:
  ```ts
  export const SOCIAL = [
    { key: "x", href: "https://x.com/elclubparty" },
    { key: "youtube", href: "https://www.youtube.com/@ElClubParty" },
    { key: "discord", href: "https://discord.gg/2WdKQVkq4U" },
  ] as const;
  ```
- Brand icons are inline SVG paths (Simple Icons X, YouTube and Discord), `aria-hidden`, `fill="currentColor"`. The accessible name comes from `footer.x` / `footer.youtube` / `footer.discord`. Colour is `text-fg-muted`, and `hover:text-fg`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/public/public-footer.test.tsx`, rendering `FooterNav` (and `SocialLinks`):
  ```ts
  it("links the seven tools, what-is, forum and donate in Spanish", () => {
    render(<FooterNav lang="es" off={new Set()} />);
    const tools = screen.getByRole("navigation", { name: "Herramientas" });
    expect(within(tools).getAllByRole("link")).toHaveLength(7);
    expect(within(tools).getByRole("link", { name: "Calculadora de gas" })).toHaveAttribute("href", localizedPath("es", "gas"));
    expect(screen.getByRole("link", { name: "¿Qué es ElClub.?" })).toHaveAttribute("href", localizedPath("es", "start"));
    expect(screen.getByRole("link", { name: "Foro" })).toHaveAttribute("href", "/foro");
    expect(screen.getByRole("link", { name: "Donar" })).toHaveAttribute("href", localizedPath("es", "donate"));
  });
  it("a switched-off tool and donate are dimmed text, not links (Review Focus 5)", () => {
    render(<FooterNav lang="en" off={new Set(["gas", "donate"])} />);
    expect(screen.queryByRole("link", { name: "Gas calculator" })).toBeNull();   // use en.tools.gas.name
    expect(screen.getByText(en.tools.gas.name)).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
  });
  it("social links open in a new tab, safely, with names", () => {
    render(<SocialLinks lang="es" />);
    for (const [name, href] of [["ElClub. en X", SOCIAL[0].href], ["ElClub. en YouTube", SOCIAL[1].href], ["ElClub. en Discord", SOCIAL[2].href]]) {
      const a = screen.getByRole("link", { name });
      expect(a).toHaveAttribute("href", href);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
  it("carries the tagline, builtOn, legal line and rights", () => { /* es.footer.tagline, es.footer.builtOn, es.common.noCustody, es.footer.rights all visible */ });
  ```
  The last test belongs to `PublicFooter`'s static shell; render whatever component holds those lines. Mock `next/navigation` `usePathname` for `LangSwitch` as `public-header.test.tsx` already does.

- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm vitest run tests/unit/public/public-footer.test.tsx`
  - Expected: FAIL (components missing).

- [ ] **Step 3: Implement.**
  - Layout:
    - Mobile is a single column.
    - From `md` it is a 4-column grid: brand (logo SVG `public/brand/logo/elclub-logo-1.svg` (already committed) at 32 px, tagline, builtOn in mono, `SocialLinks`), Herramientas, ElClub. (whatIs, forum, donate), and Idioma (`LangSwitch`).
    - Below sits a bottom bar with a `border-t`: `common.noCustody` + `connect.notAdvice`, then `footer.rights`.
  - Every link is at least 44 px tall, with the focus ring of the header (`focus-visible:ring-2 focus-visible:ring-accent`).
  - A dimmed entry is a `<span aria-disabled="true" class="text-fg-muted/60">`. Check its contrast: if it is below 4.5:1, use `text-fg-muted` plus a «(no disponible)» / «(unavailable)» suffix from `tools.unavailableNow` instead.
  - `FooterNavLive` is `async`, and does `const off = await offTools(); return <FooterNav lang={lang} off={off} />`.
  - Swap the header's inline language nav for `<LangSwitch lang={lang} />`.

- [ ] **Step 4: Run them and confirm they pass.**
  - Run: `pnpm vitest run tests/unit/public && pnpm lint && pnpm typecheck`
  - Expected: PASS.

- [ ] **Step 5: Commit** with `feat(footer): footer público con accesos, redes e idioma`.

### Task 3: First-visit intro on the home page

**Files:**
- Already committed with the plan (do not recreate): `public/brand/logo/elclub-logo-1.svg`, `public/brand/logo/elclub-logo-2.svg`
- Create: `src/lib/landing/intro.ts` (pure logic + boot script source)
- Create: `src/components/landing/intro-gate.tsx` (client)
- Modify: `src/app/(public)/[lang]/layout.tsx` (boot `<script>` as first child, before the header)
- Modify: `src/app/(public)/[lang]/page.tsx` (render `<IntroGate lang={lang} />` before the `<Suspense>`)
- Modify: `src/app/globals.css` (intro styles, wave keyframes, pause rule)
- Test: `tests/unit/landing/intro.test.ts`, `tests/unit/landing/intro-gate.test.tsx`

**Logo files** (already in the repo; vectorised from the owner's PNGs, 800×800, corner radius applied by CSS):

`elclub-logo-1.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><rect width="800" height="800" fill="#0000FF"/><path d="M271 233H485V565H271A58 58 0 0 1 213 507V291A58 58 0 0 1 271 233Z" fill="#FFFFFF"/><rect x="491" y="472" width="95" height="93" fill="#FFFFFF"/></svg>
```
`elclub-logo-2.svg`: the same with the colours swapped (background `#FFFFFF`, shapes `#0000FF`).

**Interfaces:**
- Produces, in `src/lib/landing/intro.ts`:
  ```ts
  export const INTRO_KEY = "elclub-intro-seen";
  export const INTRO_PATHS = ["/", "/en"] as const;
  export function shouldShowIntro(i: { pathname: string; seen: boolean; reducedMotion: boolean }): boolean;
  export function introBootScript(): string;        // self-contained IIFE source, try/catch around localStorage
  export function markIntroSeen(storage?: Pick<Storage, "setItem">): void;  // swallows errors (Review Focus 3)
  export function gridFor(width: number, height: number): { cols: number; rows: number };   // cols 12 when width >= 768, else 6; rows = max(1, round(cols * height / width))
  export function waveDelays(g: { cols: number; rows: number }, size: { width: number; height: number }, origin: { x: number; y: number }, msPerPx?: number): number[]; // row-major; delay = distance(tile centre, origin) * msPerPx (default 1.6)
  ```
- The boot script is the same logic as `shouldShowIntro`, inlined:
  - It reads `location.pathname` (a trailing slash is treated as equal) and `localStorage[INTRO_KEY] === "1"` inside try/catch (a throw counts as not seen), plus `matchMedia("(prefers-reduced-motion: reduce)")`.
  - If the intro should show, it sets `document.documentElement.dataset.intro = "on"`.
  - Nothing else.
- The DOM contract consumed by CSS and the e2e (Task 4):
  - `html[data-intro="on"]`: overlay visible, scroll locked, `.animate-start-rise` paused.
  - `html[data-intro="revealing"]`: overlay animating out, rises playing.
  - The attribute is removed when done.
  - The overlay is `<div data-intro-overlay>` with a full-screen `<button type="button" aria-label={t.footer.enter}>` and a skip `<a href="#main" class="sr-only focus:not-sr-only">{t.footer.skip}</a>`. `main` gets `id="main"` and `tabIndex={-1}`, in `landing.tsx`.

- [ ] **Step 1: Write the failing pure tests** in `tests/unit/landing/intro.test.ts`:
  ```ts
  expect(shouldShowIntro({ pathname: "/", seen: false, reducedMotion: false })).toBe(true);
  expect(shouldShowIntro({ pathname: "/en/", seen: false, reducedMotion: false })).toBe(true);
  expect(shouldShowIntro({ pathname: "/en", seen: true, reducedMotion: false })).toBe(false);
  expect(shouldShowIntro({ pathname: "/", seen: false, reducedMotion: true })).toBe(false);
  expect(shouldShowIntro({ pathname: "/herramientas", seen: false, reducedMotion: false })).toBe(false);
  expect(gridFor(1440, 900)).toEqual({ cols: 12, rows: 8 });
  expect(gridFor(375, 812)).toEqual({ cols: 6, rows: 13 });
  const d = waveDelays({ cols: 2, rows: 1 }, { width: 200, height: 100 }, { x: 0, y: 50 }, 1);
  expect(d).toEqual([50, 150]);
  // markIntroSeen swallows a throwing storage
  expect(() => markIntroSeen({ setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  // boot script, executed against a fake window: sets data-intro only when it should
  ```
  For the boot script, `new Function("window","document","localStorage","location","matchMedia", introBootScript())` with fakes. Cover three cases: shows on `/`; does not show when the key is `"1"`; and shows, without throwing, when `localStorage.getItem` throws.

- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `pnpm vitest run tests/unit/landing/intro.test.ts`
  - Expected: FAIL.

- [ ] **Step 3: Implement `intro.ts`** to pass the tests.

- [ ] **Step 4: Write the failing component tests** in `tests/unit/landing/intro-gate.test.tsx`.
  - Set `document.documentElement.dataset.intro = "on"` and mock `Element.prototype.animate` to return `{ finished: Promise.resolve(), cancel(){} }`.
  - Assertions:
    - The button is named "Entrar en ElClub." (es).
    - Clicking it calls `localStorage.setItem(INTRO_KEY, "1")`.
    - `dataset.intro` becomes `"revealing"` and then is removed.
    - Focus ends on `#main`.
    - Pressing Enter on the focused button does the same.
    - With no `Element.prototype.animate` (deleted), clicking still removes the attribute (no-WAAPI fallback).
    - With `dataset.intro` unset, the component renders nothing interactive (`queryByRole("button")` is null).

- [ ] **Step 5: Implement `IntroGate({ lang })`**, the client component. The sequence follows the approved mockup `intro-v2.html`, variant C, with the square wave from `intro-v1.html`; both live in `.superpowers/brainstorm/56119-1793044407/content/`:
  1. Idle: logo 1 at `min(40vmin, 220px)`, `border-radius: 24px`, centred on `--bg`. Three square outline rings of `--color-accent-fill`, phased 0 / 0.8 / 1.6 s on a 2.4 s loop, scale 1 → 2.6, opacity .7 → 0. No text.
  2. Pointerdown anywhere on the overlay, or Enter/Space on the button: record the origin (the button centre for the keyboard), then hide the rings.
  3. Flip about 520 ms (rotateY 0 → 90° scale 1.12 → 180°), swapping to logo 2 at the midpoint.
  4. Zoom about 900 ms, `cubic-bezier(.75,0,.2,1)`, with the transform-origin at the mark centre (43.6% 49.9% of the tile), until the mark covers the viewport (scale = `max(vw / markW, vh / markH) * 1.6`). Then swap to a full-screen blue layer.
  5. Lay out a `gridFor(innerWidth, innerHeight)` grid of blue tiles. Each tile animates with `waveDelays(...)`: rotateX or rotateY (by its dominant axis from the origin) 0 → ±70° (colour Cerulean) → ±180° with opacity 0, 620 ms each, `backface-visibility: hidden`, `perspective: 500px`.
  6. On the last tile's `finished`, remove the overlay and the attribute, and focus `#main`.

  Implementation rules:
  - Set `dataset.intro = "revealing"` at the start of step 5.
  - Call `markIntroSeen()` at step 2.
  - Unlock scroll only at the end.
  - Animate only `transform`, `opacity` and `background-color` on the tiles.
  - When `Element.prototype.animate` is missing, skip to step 6.

- [ ] **Step 6: Wire it.**
  - Layout: `<script dangerouslySetInnerHTML={{ __html: introBootScript() }} />` as the first child of the `lang` wrapper. The root `<html>` already has `suppressHydrationWarning`.
  - Page: `<IntroGate lang={lang} />` before the `<Suspense>`.
  - CSS in `globals.css`:
    - `[data-intro-overlay]{display:none}`
    - `html[data-intro] [data-intro-overlay]{display:grid; position:fixed; inset:0; z-index:100}`
    - `html[data-intro="on"]{overflow:hidden}`
    - `html[data-intro="on"] .animate-start-rise{animation-play-state:paused}`
    - the ring keyframes, under `@media (prefers-reduced-motion: no-preference)`.
  - Add `id="main" tabIndex={-1}` to `<main>` in `src/components/landing/landing.tsx`, with a focus ring that does not show for programmatic focus (`outline-none`).

- [ ] **Step 7: Run the tests and confirm they pass.**
  - Run: `pnpm vitest run tests/unit/landing tests/unit/public tests/unit/i18n && pnpm lint && pnpm typecheck`
  - Expected: PASS. Also run `pnpm vitest run tests/unit/i18n/proxy-matcher.test.ts` or the existing matcher test: `public/brand/logo/*.svg` must still be excluded by the proxy matcher (`brand/[^/]+/[^/]+\.svg$`).

- [ ] **Step 8: Commit** with `feat(landing): entrada interactiva en la primera visita`.

### Task 4: E2E, screenshots and full verification

**Files:**
- Create: `e2e/intro-seen.json`. This is Playwright storageState with origin `http://localhost:3000` and `localStorage` `[{ name: "elclub-intro-seen", value: "1" }]`, and no cookies.
- Modify: `playwright.config.ts` to add `storageState: "e2e/intro-seen.json"` to the top-level `use`.
- Create: `e2e/landing-intro.spec.ts`.

- [ ] **Step 1: Write `e2e/landing-intro.spec.ts`** with `test.use({ storageState: { cookies: [], origins: [] } })`:
  - **First visit:**
    1. `/`: `[data-intro-overlay]` is visible.
    2. Click at (80% width, 60% height).
    3. Within 6 s the overlay is detached, `html` has no `data-intro`, and the hero `h1` "Herramientas cripto gratis y seguras" is visible.
    4. `localStorage["elclub-intro-seen"] === "1"`.
  - **Reload:** for 1 s after `domcontentloaded`, the overlay is never visible. Poll `isVisible` every 50 ms (Review Focus 1).
  - **`/en` after `/`:** no overlay (shared key).
  - **Keyboard on a fresh context:**
    1. Tab: the focused element is the button named "Entrar en ElClub."
    2. Enter: revealed.
    3. `document.activeElement.id === "main"`.
  - **Reduced motion** (`page.emulateMedia({ reducedMotion: "reduce" })` before `goto`): no overlay.
  - **Deep link** to `/herramientas` on a fresh context: no overlay.
  - **Footer:** on `/herramientas`, the footer has the X, YouTube and Discord links with the exact hrefs, and clicking «EN» in the footer lands on `/en/tools`.
  - **Screenshots** only when `ADMIN_SHOTS_DIR` is set, following the `admin-maintenance.spec.ts` pattern:
    - idle intro at 1440×900 and at 375×812;
    - mid-wave about 1.9 s after the click;
    - the footer at both sizes.

- [ ] **Step 2: Run the spec.**
  - Run: `export PATH="$PATH:/c/Windows/System32"; pnpm exec playwright test e2e/landing-intro.spec.ts`
  - Expected: all pass.

- [ ] **Step 3: Full verification.** Record the counts in the report, and re-run known flakes alone (start-metadata, realtime-ticket, split-calculator).
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:e2e` (every existing spec must pass with the storageState)
  - `E2E_PROD=1 pnpm test:e2e`
  - `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`

- [ ] **Step 4: Look at the screenshots.**
  - Check that the idle state shows only the logo and rings, with no text.
  - Check that the footer has no blue fill and its columns are aligned.
  - Fix anything off.

- [ ] **Step 5: Commit** with `test(e2e): entrada de la landing y footer`.
