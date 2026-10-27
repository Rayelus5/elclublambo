import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clubPath, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { watchCsp } from "./helpers/csp";

// /start: the public landing. Served with and without a session (no login or welcome redirect), under the full CSP,
// without console errors or horizontal scroll, and fully readable with reduced motion. Run in dev and with E2E_PROD=1.
test.describe.configure({ mode: "serial" });

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = [];
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) errors.push(`console: ${m.text()} @ ${m.location().url}`);
  });
  context.on("weberror", (e) => errors.push(`pageerror: ${e.error().message}`));
  return errors;
}

/** Scrolls the whole page in viewport steps (scroll-linked and in-view effects run), then back to the top. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => window.innerHeight / 2);
  for (let y = 0; y <= height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("anonymous: /start answers 200 in place, with its metadata, no errors, no CSP violation and no horizontal scroll", async ({ browser }) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport });
    const errors = trackErrors(context);
    const page = await context.newPage();
    const readCsp = await watchCsp(page);
    const res = await page.goto("/start");
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/start");
    await expect(page.getByRole("heading", { level: 1, name: "ElClub." })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await scrollThrough(page);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.waitForLoadState("networkidle");
    expect(await readCsp()).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("the share card and robots.txt are public; outside production nothing is indexable", async ({ page, request }) => {
  await page.goto("/start");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.elclub.party/start");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toBeTruthy();
  const image = await request.get(new URL(og!).pathname + new URL(og!).search, { maxRedirects: 0 });
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  const robots = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  // The e2e server is not production (localhost): nothing is indexable there (robots.ts, isProductionSite).
  expect(await robots.text()).toMatch(/Disallow: \/\s*$/);
  expect(await robots.text()).not.toContain("Allow: /start");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("signed in (welcome still pending): /start is served as is, without redirects", async ({ browser }) => {
  const context = await browser.newContext();
  const errors = trackErrors(context);
  await loginAs(context, E2E_SUPER_ADMIN_PK, { onboard: false });
  const page = await context.newPage();
  const res = await page.goto("/start");
  expect(res?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/start");
  await expect(page.getByRole("heading", { level: 1, name: "ElClub." })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("«Solicitar invitación» is disabled («Próximamente») and goes nowhere", async ({ page }) => {
  await page.goto("/start");
  const button = page.getByRole("button", { name: /Solicitar invitación/ });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toBeDisabled();
  await expect(button).toContainText("Próximamente");
  await button.click({ force: true });
  expect(new URL(page.url()).pathname).toBe("/start");
  await expect(page.getByText(/¿Ya tienes invitación\?/)).toBeVisible();
});

test("with reduced motion every piece of text is visible: nothing faded, nothing waiting for a reveal", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/start");
  await page.waitForLoadState("networkidle");
  const hidden = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main p, main li, footer p")) {
      const r = el.getBoundingClientRect();
      if (!el.textContent?.trim() || r.width === 0 || r.height === 0) continue; // sr-only / responsive hides
      let node: HTMLElement | null = el;
      let opacity = 1;
      while (node) {
        opacity *= Number(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (opacity < 1) out.push(`${el.tagName} ${opacity} ${el.textContent.trim().slice(0, 40)}`);
    }
    return out;
  });
  expect(hidden).toEqual([]);
  await context.close();
});

test("with motion, scrolling through reveals everything by the end", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/start");
  await scrollThrough(page);
  await page.waitForTimeout(1500);
  for (const name of ["Qué hay dentro", "Moderación seria", "La cadena de confianza", "Cómo se entra", "Firma para entrar"]) {
    const heading = page.getByRole("heading", { name });
    await heading.scrollIntoViewIfNeeded();
    await expect.poll(() => heading.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  }
  await context.close();
});

test("/en/start answers 200 in English, links to the English tools and keeps the invitation request disabled", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const errors = trackErrors(context);
  const page = await context.newPage();
  const res = await page.goto("/en/start");
  expect(res?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/en/start");
  await expect(page.getByRole("heading", { level: 1, name: "ElClub." })).toBeVisible();
  await expect(page.getByText("A private crypto forum for every level")).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.elclub.party/en/start");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_US");
  expect(await horizontalOverflow(page)).toBe(0);
  await scrollThrough(page);
  expect(await horizontalOverflow(page)).toBe(0);
  const tools = page.getByRole("link", { name: "See the tools" });
  await tools.scrollIntoViewIfNeeded();
  await expect(tools).toHaveAttribute("href", "/en/tools");
  const button = page.getByRole("button", { name: /Request an invitation/ });
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Solicitar invitación")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("the Spanish /start links to /herramientas and the OG card renders per language", async ({ page, request }) => {
  await page.goto("/start");
  const tools = page.getByRole("link", { name: "Ver las herramientas" });
  await tools.scrollIntoViewIfNeeded();
  await expect(tools).toHaveAttribute("href", "/herramientas");
  for (const route of ["/start", "/en/start"]) {
    await page.goto(route);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og, route).toBeTruthy();
    const image = await request.get(new URL(og!).pathname + new URL(og!).search, { maxRedirects: 0 });
    expect(image.status(), route).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
  }
});

test("/foro/login points newcomers to /start", async ({ page }) => {
  await page.goto(clubPath("/login"));
  const link = page.getByRole("link", { name: "¿Qué es ElClub.?" });
  await expect(link).toHaveAttribute("href", "/start");
  await link.click();
  await expect(page).toHaveURL(/\/start$/);
});
