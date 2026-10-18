import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { service } from "./helpers/f2c";
import { LONG_NAME, MOCK_PORT } from "./mock/coingecko.mjs";

// F4b acceptance: /mercado and /mercado/[id] against the local mock CoinGecko (e2e/mock/coingecko.mjs, wired through
// COINGECKO_API_BASE in playwright.config.ts). The server cache lives in `market_cache` (service role only); the
// outage scenarios control it directly instead of waiting on the 60 s / 5 min TTLs. Scenarios share state: serial.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// The mock's Bitcoin row (67234.56 USD) as the es-ES formatter prints it.
const BTC_PRICE = "67.234,56 USD";

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url}`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

// 1x1 transparent PNG: the coin icons are served locally so the spec never reaches the real CoinGecko image CDN.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
async function memberContext(browser: import("@playwright/test").Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  trackErrors(context);
  await context.route("https://coin-images.coingecko.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  return context;
}

async function mock(action: "__fail" | "__ok") {
  const res = await fetch(`${MOCK}/${action}`, { method: "POST" });
  expect(res.ok).toBe(true);
}

async function clearCache() {
  const { error } = await service().from("market_cache").delete().neq("key", "");
  expect(error).toBeNull();
}

const rows = (page: Page) => page.locator("table tbody tr");
const coinLink = (page: Page, name: string) => page.getByRole("table").getByRole("link", { name: new RegExp(`^${name}\\b`) });

let admin: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  await mock("__ok");
  await clearCache();
  admin = await memberContext(browser, desktop);
  page = await admin.newPage();
});

test.afterAll(async () => {
  // Never leave the mock in outage mode for a later spec.
  await mock("__ok");
  await admin?.close();
});

test("1. desktop: Mercado in the top bar; top 100 with Bitcoin first, '—' for the null price, attribution and time", async () => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" });
  await nav.getByRole("link", { name: "Mercado" }).click();
  await expect(page).toHaveURL(/\/mercado$/);
  await expect(page.getByRole("heading", { level: 1, name: "Mercado" })).toBeVisible();

  await expect(rows(page)).toHaveCount(100, { timeout: 30_000 });
  const first = rows(page).first();
  await expect(first.getByRole("link", { name: /^Bitcoin/ })).toBeVisible();
  await expect(first.getByRole("cell").nth(2)).toHaveText(BTC_PRICE);
  // Bitcoin's icon is on a CoinGecko host: rendered. The foreign-host icon is not.
  await expect(first.locator("img")).toHaveCount(1);
  await expect(rows(page).nth(2).getByRole("link", { name: /^Foreign Image Coin/ })).toBeVisible();
  await expect(rows(page).nth(2).locator("img")).toHaveCount(0);

  // Row 2: no price and no sparkline, still a row, with a dash for the price.
  const nullRow = rows(page).nth(1);
  await expect(nullRow.getByRole("link", { name: /^Null Price Coin/ })).toBeVisible();
  await expect(nullRow.getByRole("cell").nth(2)).toHaveText("—");
  await expect(nullRow.getByRole("img")).toHaveCount(0);
  // Bitcoin's sparkline carries a text equivalent.
  await expect(first.getByRole("img", { name: /^Tendencia de 7 días de Bitcoin: (sube|baja|sin cambios)$/ })).toBeVisible();

  const attribution = page.getByRole("link", { name: "Datos de CoinGecko" });
  await expect(attribution).toHaveAttribute("href", "https://www.coingecko.com");
  await expect(attribution).toHaveAttribute("target", "_blank");
  await expect(attribution).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByText(/^Actualizado a las \d{2}:\d{2}$/)).toBeVisible();
});

test("2. Bitcoin page: heading, range switch to 30 d updates URL and chart, facts visible", async () => {
  await coinLink(page, "Bitcoin").click();
  await expect(page).toHaveURL(/\/mercado\/bitcoin$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Bitcoin/ })).toBeVisible({ timeout: 30_000 });

  const ranges = page.getByRole("navigation", { name: "Periodo del gráfico" });
  // Default range: 7 days.
  await expect(ranges.getByRole("link", { name: "7 d" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("img", { name: /^Precio de Bitcoin en 7 días:/ })).toBeVisible();

  await ranges.getByRole("link", { name: "30 d" }).click();
  await expect(page).toHaveURL(/\/mercado\/bitcoin\?r=30$/);
  await expect(ranges.getByRole("link", { name: "30 d" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("img", { name: /^Precio de Bitcoin en 30 días:/ })).toBeVisible();
  await expect(page.getByText(/en 30 días$/)).toBeVisible();

  // Key data.
  // (The right rail has its own <dl> for the fund: pick the coin's.)
  const facts = page.locator("main dl").filter({ hasText: "Suministro máximo" });
  await expect(facts.getByRole("term")).toContainText(["Precio", "Variación 24 h", "Capitalización", "Volumen 24 h", "Puesto"]);
  await expect(facts.getByRole("definition").first()).toHaveText(BTC_PRICE);
  await expect(facts).toContainText("21.000.000 BTC");
  await expect(facts.getByRole("link", { name: "bitcoin.org" })).toHaveAttribute("href", "https://bitcoin.org");
  await expect(page.getByRole("link", { name: "Datos de CoinGecko" })).toBeVisible();
});

const notFoundText = "This page could not be found.";

test("3. unknown coin shows the not-found page and is not cached; an invalid id is a real 404", async () => {
  // notFound() runs inside the page's Suspense, so the document may already be a streamed 200 (ruling F4b-R3):
  // assert on the content, not the status.
  await page.goto("/mercado/no-existe");
  await expect(page.getByText(notFoundText)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("table")).toHaveCount(0);
  const { data, error } = await service().from("market_cache").select("key").like("key", "%no-existe%");
  expect(error).toBeNull();
  expect(data).toEqual([]);

  // An id that fails validation is a real 404 status: the proxy decides it (src/lib/market/guard.ts) before the forum
  // layout's Suspense starts streaming.
  const res = await page.goto("/mercado/..%2Fx");
  expect(res?.status()).toBe(404);
  await expect(page.getByText(notFoundText)).toBeVisible();
});

test("4. outage: stale copy with its time after a good fetch; clear error with Reintentar without any copy", async () => {
  await clearCache();
  await page.goto("/mercado");
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByText(/^Actualizado a las/)).toBeVisible();

  // Age the list copy past its 60 s TTL, then take the API down.
  const aged = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: updated, error } = await service()
    .from("market_cache")
    .update({ fetched_at: aged })
    .eq("key", "markets:top100")
    .select("key");
  expect(error).toBeNull();
  expect(updated).toHaveLength(1);
  await mock("__fail");
  try {
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^No se pudo actualizar\. Datos de las \d{2}:\d{2}\.$/ })).toBeVisible();
    await expect(coinLink(page, "Bitcoin")).toBeVisible();
    await expect(rows(page)).toHaveCount(100);
    await expect(page.getByText(/^Actualizado a las/)).toHaveCount(0);

    // No copy at all: a clear error, never an empty table.
    await clearCache();
    await page.reload();
    const alert = page.getByRole("alert").filter({ hasText: "No se pudieron cargar los precios" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link", { name: "Reintentar" })).toHaveAttribute("href", "/mercado");
    await expect(page.getByRole("table")).toHaveCount(0);
  } finally {
    await mock("__ok");
  }

  // Back up: Reintentar loads fresh data.
  await page.getByRole("link", { name: "Reintentar" }).click();
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByText(/^Actualizado a las/)).toBeVisible();
});

test("5. 375 px: no horizontal scroll (even with a very long coin name), secondary columns hidden; wider screens stay inside main", async ({ browser }) => {
  const mobile = await memberContext(browser, { width: 375, height: 812 });
  try {
    const m = await mobile.newPage();
    await m.goto("/mercado");
    await expect(rows(m)).toHaveCount(100);
    const long = m.getByRole("table").getByRole("link", { name: LONG_NAME });
    await expect(long).toBeVisible();
    await expect(m.getByRole("columnheader", { name: "Capitalización" })).toBeHidden();
    await expect(m.getByRole("columnheader", { name: "Cripto" })).toBeVisible();
    await expect(m.getByRole("columnheader", { name: "Precio" })).toBeVisible();
    await expect(m.getByRole("columnheader", { name: "24 h" })).toBeVisible();
    const widths = await m.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(widths.doc).toBeLessThanOrEqual(375);
    expect(widths.body).toBeLessThanOrEqual(375);
    // The long name is cut inside its cell, not by the viewport edge.
    const box = await long.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    // Rank, coin, price and 24 h fit: the panel does not need to scroll sideways at 375 px either.
    const panel = m.getByTestId("market-table-panel");
    expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

    // Wider screens show every column: the page still never scrolls sideways and the table stays inside <main>
    // (if all the columns do not fit, the panel itself scrolls).
    for (const width of [768, 1024, 1280]) {
      await m.setViewportSize({ width, height: 900 });
      await expect(m.getByRole("columnheader", { name: "Capitalización" })).toBeVisible();
      const fit = await m.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        panelRight: document.querySelector("[data-testid=market-table-panel]")!.getBoundingClientRect().right,
        mainRight: document.querySelector("main")!.getBoundingClientRect().right,
      }));
      expect(fit.doc, `scrollWidth at ${width}px`).toBeLessThanOrEqual(width);
      expect(fit.panelRight, `table panel inside <main> at ${width}px`).toBeLessThanOrEqual(fit.mainRight);
    }
  } finally {
    await mobile.close();
  }
});

test("6. an anonymous visitor never sees the market table", async ({ browser }) => {
  const anon = await browser.newContext();
  trackErrors(anon);
  try {
    const p = await anon.newPage();
    await p.goto("/mercado");
    await expect(p).toHaveURL(/\/login(\?|$)/);
    await expect(p.getByRole("table")).toHaveCount(0);
  } finally {
    await anon.close();
  }
});

test("7. no browser errors in any context", () => {
  // The browser's own "Failed to load resource ... 404" for the not-found documents this spec requested on purpose.
  const expected404 = (e: string) =>
    /status of 404/.test(e) && ["/mercado/no-existe", "/mercado/..%2Fx"].some((path) => e.endsWith(`@ http://localhost:3000${path}`));
  // Reown AppKit re-fetches the page URL to check its COOP header; on a real 404 document it logs this line.
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  expect(browserErrors.filter((e) => !expected404(e) && !coopOn404(e))).toEqual([]);
});
