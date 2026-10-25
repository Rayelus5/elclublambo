import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { watchCsp } from "./helpers/csp";

// P2 Task 11: the public landing at / (Spanish) and /en. No horizontal scroll at 375/768/1440, no CSP violation or
// console error, every piece of text visible with reduced motion, and «Crear sorteo» leads to the create page.
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

async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => window.innerHeight / 2);
  for (let y = 0; y <= height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("anonymous: / is the landing at 375, 768 and 1440 px, without horizontal scroll, CSP violations or errors", async ({ browser }) => {
  for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const errors = trackErrors(context);
    const page = await context.newPage();
    const readCsp = await watchCsp(page);
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Herramientas cripto honestas, verificables y gratis." })).toBeVisible();
    expect(await horizontalOverflow(page), `overflow at ${width}`).toBe(0);
    await scrollThrough(page);
    expect(await horizontalOverflow(page), `overflow at ${width} after scrolling`).toBe(0);
    await page.waitForLoadState("networkidle");
    expect(await readCsp()).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("/en is the English landing with its own locale and share card", async ({ page, request }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1, name: "Honest, verifiable, free crypto tools." })).toBeVisible();
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_US");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toBeTruthy();
  const image = await request.get(new URL(og!).pathname, { maxRedirects: 0 });
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("/ has the Spanish locale and share card", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "es_ES");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toBeTruthy();
  const image = await request.get(new URL(og!).pathname, { maxRedirects: 0 });
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("with reduced motion every piece of text is visible", async ({ browser }) => {
  for (const path of ["/", "/en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const hidden = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main p, main li, main a, main button")) {
        const r = el.getBoundingClientRect();
        if (!el.textContent?.trim() || r.width === 0 || r.height === 0) continue;
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
    expect(hidden, path).toEqual([]);
    await context.close();
  }
});

test("with motion, scrolling through reveals every block by the end", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await scrollThrough(page);
  await page.waitForTimeout(1500);
  for (const heading of await page.getByRole("heading", { level: 2 }).all()) {
    await heading.scrollIntoViewIfNeeded();
    await expect.poll(() => heading.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  }
  await context.close();
});

test("«Crear enlace de pago» is disabled («Próximamente») and goes nowhere", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: /Crear enlace de pago/ }).last();
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toContainText("Próximamente");
  await button.click({ force: true });
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe("/");
});

test("«Crear sorteo» leads to the create page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Crear sorteo" }).first().click();
  await expect(page).toHaveURL(/\/herramientas\/sorteos\/nuevo$/);
});
