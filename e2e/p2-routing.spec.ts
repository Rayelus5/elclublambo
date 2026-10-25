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
  // Unknown single segment: the login gate lets a member through and the proxy answers the 404 (the [lang] layout's
  // notFound() would stream a 200).
  const unknown = await page.goto("/xx");
  expect(unknown?.status()).toBe(404);
  await context.close();
});

// An unknown giveaway id: the page streams under <Suspense>, so the proxy decides the 404 (ES and EN, with or without a
// session). The share card of an unknown id stays the generic PNG (covered in p2-giveaways).
for (const path of ["/herramientas/sorteos/00000000-0000-4000-8000-000000000000", "/en/tools/giveaways/00000000-0000-4000-8000-000000000000"]) {
  test(`anonymous: an unknown giveaway ${path} answers 404`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
  });
}

test("outside production robots.txt and sitemap.xml index nothing", async ({ request }) => {
  const robots = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/Disallow: \/\s*$/);
  const sitemap = await request.get("/sitemap.xml", { maxRedirects: 0 });
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain("<loc>");
});

// P3: ElClub Pay and the public donate page.
const ADDR = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";
for (const path of ["/herramientas/pay", "/en/tools/pay", `/pay/${ADDR}`, `/en/pay/${ADDR}`, "/donar", "/en/donate"]) {
  test(`anonymous: ${path} answers 200 in place (public page)`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator("div[lang]")).toHaveCount(1);
  });
}

test("a short alias or a chain outside the environment is not a public URL", async ({ request }) => {
  const short = await request.get("/pay/ab", { maxRedirects: 0 });
  expect(short.status()).not.toBe(200);
  const chain = await request.get(`/pay/tx/1/0x${"ab".repeat(32)}`, { maxRedirects: 0 });
  expect(chain.status()).not.toBe(200);
});

test("/es/donate redirects (308) to /donar", async ({ request }) => {
  const res = await request.get("/es/donate", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers()["location"] ?? "", "http://localhost").pathname).toBe("/donar");
});

test("a member at /donar sees the club page, not the public one", async ({ browser }) => {
  const context = await browser.newContext();
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  const page = await context.newPage();
  const res = await page.goto("/donar");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Donar" })).toBeVisible();
  await expect(page.locator("div[lang='es']")).toHaveCount(0);
  await context.close();
});
