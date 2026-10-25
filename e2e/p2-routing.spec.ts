import { expect, test } from "@playwright/test";
import { clubPath, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";

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

test("a member at / sees the landing with «Ir al foro», which opens the forum under /foro (R1)", async ({ browser }) => {
  const context = await browser.newContext();
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  const page = await context.newPage();
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Herramientas cripto honestas, verificables y gratis." })).toBeVisible();
  await page.getByRole("group", { name: "Tu cuenta" }).getByRole("link", { name: "Ir al foro" }).click();
  await page.waitForURL((u) => u.pathname === clubPath());
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  // Cache Components keeps the landing in a hidden <Activity>: only a visible public wrapper would be wrong.
  await expect(page.locator("div[lang='es']:visible")).toHaveCount(0);
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
for (const path of ["/herramientas/pay", "/en/tools/pay", `/pay/${ADDR}`, `/en/pay/${ADDR}`, "/donar", "/en/donate", "/herramientas/comprobador", "/en/tools/checker", "/herramientas/comprobador/api", "/en/tools/checker/api"]) {
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

test("a member at /donar sees the public page with «Dona desde el club» → /foro/donar (R1-R3)", async ({ browser }) => {
  const context = await browser.newContext();
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  const page = await context.newPage();
  const res = await page.goto("/donar");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Donar" })).toBeVisible();
  await expect(page.locator("div[lang='es']")).toHaveCount(1);
  const toClub = page.getByRole("link", { name: "Dona desde el club" });
  await expect(toClub).toHaveAttribute("href", clubPath("/donar"));
  await toClub.click();
  await page.waitForURL((u) => u.pathname === clubPath("/donar"));
  await expect(page.locator("div[lang='es']:visible")).toHaveCount(0);
  await context.close();
});

// P5: the vouches tool, in both languages; the wrong language's segment is not a page.
for (const path of ["/herramientas/avales", "/en/tools/vouches"]) {
  test(`anonymous: ${path} answers 200 in place (public page)`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator("div[lang]")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("/es/tools/vouches redirects (308) to /herramientas/avales", async ({ request }) => {
  const res = await request.get("/es/tools/vouches", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers()["location"] ?? "", "http://localhost").pathname).toBe("/herramientas/avales");
});

// P6: the three DeFi tools, in both languages; the wrong language's segment is not a page.
for (const path of ["/herramientas/aprobaciones", "/en/tools/approvals", "/herramientas/envio-multiple", "/en/tools/multisend", "/herramientas/gas", "/en/tools/gas"]) {
  test(`anonymous: ${path} answers 200 in place (public page)`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator("div[lang]")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("P6: the gas page reads both local nodes, with their L1 oracles", async ({ page }) => {
  await page.goto("/en/tools/gas");
  await expect(page.getByRole("region", { name: "Base Sepolia" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Arbitrum Sepolia" })).toBeVisible();
  await expect(page.getByText("This network could not be read. Try again in a moment.")).toHaveCount(0);
  await expect(page.getByText("without the L1 part")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Ethereum (base fee only, reference)" })).toBeVisible();
});

test("/en/herramientas/gas is not a page; /es/tools/multisend redirects (308) to /herramientas/envio-multiple", async ({ request }) => {
  expect((await request.get("/en/herramientas/gas", { maxRedirects: 0 })).status()).not.toBe(200);
  const res = await request.get("/es/tools/multisend", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers()["location"] ?? "", "http://localhost").pathname).toBe("/herramientas/envio-multiple");
});
