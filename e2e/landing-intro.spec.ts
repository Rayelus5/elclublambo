import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Landing intro (first visit) and public footer. Starts as a first-time visitor (no seen mark); the rest of the suite
// runs with e2e/intro-seen.json. Opt-in captures with ADMIN_SHOTS_DIR.
test.use({ storageState: { cookies: [], origins: [] } });

const SHOTS = process.env.ADMIN_SHOTS_DIR;
const H1 = "Herramientas cripto gratis y seguras";
const overlay = (page: Page) => page.locator("[data-intro-overlay]");

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, caret: "initial" });
}

/** The overlay is server-rendered and visible before React hydrates; the Tab handler only exists after. */
async function hydrated(page: Page) {
  await expect(overlay(page)).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-intro-overlay] button");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
}

/** First Tab from a clean slate. React's effect that traps Tab runs just after hydration, so retry from `body` until it lands. */
async function tabToButton(page: Page) {
  await expect(async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Entrar en ElClub." })).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

async function expectRevealed(page: Page) {
  await expect(overlay(page)).toHaveCount(0, { timeout: 6000 });
  await expect(page.locator("html")).not.toHaveAttribute("data-intro", /.*/);
  await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible();
}

test("first visit: click plays the intro, reveals the landing and marks it seen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await hydrated(page);
  await shot(page, "intro-idle-1440");
  await page.mouse.click(1440 * 0.8, 900 * 0.6);
  await page.waitForTimeout(1900);
  await shot(page, "intro-wave-1440");
  await expectRevealed(page);
  expect(await page.evaluate(() => localStorage.getItem("elclub-intro-seen"))).toBe("1");
});

test("first visit at phone width: idle and mid-wave captures", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await hydrated(page);
  await shot(page, "intro-idle-375");
  await page.mouse.click(375 * 0.8, 812 * 0.6);
  await page.waitForTimeout(1900);
  await shot(page, "intro-wave-375");
  await expectRevealed(page);
});

test("reload after the intro: the overlay is never visible", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);
  await page.mouse.click(600, 400);
  await expectRevealed(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    expect(await overlay(page).isVisible()).toBe(false);
    await page.waitForTimeout(50);
  }
});

test("/en after / shares the seen mark: no overlay", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);
  await page.mouse.click(600, 400);
  await expectRevealed(page);
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    expect(await overlay(page).isVisible()).toBe(false);
    await page.waitForTimeout(50);
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("keyboard: Tab focuses the button, Enter reveals and focus lands on #main", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);
  await tabToButton(page);
  await page.keyboard.press("Enter");
  await expectRevealed(page);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main");
});

test("keyboard: Tab twice reaches «Saltar» and Enter reveals at once", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);
  await tabToButton(page);
  await page.keyboard.press("Tab");
  await expect(overlay(page).getByRole("link", { name: "Saltar" })).toBeFocused();
  // No animation: record every data-intro value from now on and assert it never reads "revealing".
  await page.evaluate(() => {
    const w = window as unknown as { __intro: string[] };
    w.__intro = [];
    new MutationObserver(() => w.__intro.push(document.documentElement.dataset.intro ?? "")).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-intro"],
    });
  });
  await page.keyboard.press("Enter");
  await expect(overlay(page)).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { __intro: string[] }).__intro);
  expect(seen).not.toContain("revealing");
});

test("reduced motion: no overlay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    expect(await overlay(page).isVisible()).toBe(false);
    await page.waitForTimeout(50);
  }
  await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible();
});

test("deep link to /herramientas: no overlay", async ({ page }) => {
  await page.goto("/herramientas", { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    expect(await overlay(page).isVisible()).toBe(false);
    await page.waitForTimeout(50);
  }
});

test("footer: social links and the language switch", async ({ page }) => {
  for (const [width, height] of [[1440, 900], [375, 812]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/herramientas");
    const footer = page.getByRole("contentinfo");
    await footer.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await shot(page, `footer-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/herramientas");
  const footer = page.getByRole("contentinfo");
  await expect(footer.locator('a[href="https://x.com/elclubparty"]')).toBeVisible();
  await expect(footer.locator('a[href="https://www.youtube.com/@ElClubParty"]')).toBeVisible();
  await expect(footer.locator('a[href="https://discord.gg/2WdKQVkq4U"]')).toBeVisible();
  await footer.getByRole("link", { name: "en", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/tools$/);
});

test("tap before hydration: one tap reveals the landing and marks it seen", async ({ page }) => {
  // Hold every JS chunk back (until the tap) so the server-rendered overlay is tapped before React exists.
  let tapped = false;
  await page.route("**/_next/static/chunks/**", async (route) => {
    for (let i = 0; i < 200 && !tapped; i++) await new Promise((r) => setTimeout(r, 50));
    await route.continue().catch(() => {});
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/", { waitUntil: "commit" });
  await expect(overlay(page)).toBeVisible({ timeout: 60_000 });
  await page.mouse.click(375 * 0.8, 812 * 0.6);
  tapped = true;
  await expectRevealed(page);
  expect(await page.evaluate(() => localStorage.getItem("elclub-intro-seen"))).toBe("1");
});

test("leaving the home with the gate up: html[data-intro] goes and the page scrolls", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('footer a[href="/herramientas"], header a[href="/herramientas"]')?.click());
  await expect(page).toHaveURL(/\/herramientas$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-intro", /.*/);
  // The previous route may stay mounted but hidden (Activity), so check visibility, not presence.
  await expect(overlay(page)).toBeHidden();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("reduced motion: no overlay and the visit is marked seen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(overlay(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("elclub-intro-seen"))).toBe("1");
});

test("client navigation into the home logs no React script-tag error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  await page.goto("/herramientas");
  await page.getByRole("banner").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible();
  expect(errors.filter((e) => e.includes("script tag"))).toEqual([]);
});
