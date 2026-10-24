import { expect, test } from "@playwright/test";
import { E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";

// P2 routing: the bilingual public tree. Spanish URLs are rewritten by the proxy to /es/*, English lives under /en/*.
test.describe.configure({ mode: "serial" });

test("anonymous: / is the public landing (200, no /login redirect)", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator("div[lang='es']")).toHaveCount(1);
});

for (const path of ["/en", "/herramientas", "/en/tools", "/start", "/en/start"]) {
  test(`anonymous: ${path} answers 200 in place`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
  });
}

test("/en is English, / is Spanish", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("div[lang='en']")).toHaveCount(1);
  await page.goto("/herramientas");
  await expect(page.locator("div[lang='es']")).toHaveCount(1);
});

test("the internal /es tree redirects (308) to the canonical Spanish URL", async ({ request }) => {
  const res = await request.get("/es/tools", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers()["location"] ?? "", "http://localhost").pathname).toBe("/herramientas");
});

test("a member at / sees the forum, not the landing", async ({ browser }) => {
  const context = await browser.newContext();
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  const page = await context.newPage();
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await expect(page.locator("div[lang='es']")).toHaveCount(0);
  // Unknown language segment: the login gate lets a member through, so the [lang] route answers 404.
  const unknown = await page.goto("/xx");
  expect(unknown?.status()).toBe(404);
  await context.close();
});

test("outside production robots.txt and sitemap.xml index nothing", async ({ request }) => {
  const robots = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/Disallow: \/\s*$/);
  const sitemap = await request.get("/sitemap.xml", { maxRedirects: 0 });
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain("<loc>");
});
