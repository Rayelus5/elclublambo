import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { CHAINS } from "./chain/shared.mjs";
import { service } from "./helpers/f2c";
import { MOCK_CREATOR } from "./mock/checker.mjs";

// P4 acceptance of the checker (/herramientas/comprobador, /en/tools/checker) and its free API (/api/v1/check/*).
// Anonymous throughout. The token report reads the local Base node (the mock USDC start-chain.mjs puts at Circle's
// address) and the local mock of Blockscout/Sourcify (e2e/mock/checker.mjs, ruling R-A): verified with a `mint`
// function, and a Cloudflare-style 403 on the creation transaction, so the age must read «Desconocido». x402 is off
// (X402_ENABLED empty), so the API is free and limited by IP (api_free 60/h); the limit is reached by seeding hits for
// a test IP through the same RPC the server calls, never by looping the API.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const USDC = CHAINS[BASE].usdc;
const phone = { width: 375, height: 812 };
/** Cyrillic «аррӏе.com»: renders like apple.com, the textbook homograph. */
const PUNYCODE_LINK = "https://xn--80ak6aa92e.com/login";
/** TEST-NET-3 addresses (RFC 5737), one per scenario so the limiter buckets never share a subject. */
const STAMP = Date.now() % 250;
const IP_FREE = `203.0.113.${STAMP + 1}`;
const IP_LIMITED = `198.51.100.${STAMP + 1}`;

/** The limiter's subject for `ip`, as src/lib/rate-limit/ip.ts computes it (HMAC with the service key, never the IP). */
const ipSubject = (ip: string) => `ip:${createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(ip).digest("hex").slice(0, 32)}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The value cell of a report row, by its label. */
const row = (page: Page, label: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

test("anonymous checks the local USDC: sections from the chain and the mock, the blocked source reads «Desconocido»", async ({ page }) => {
  const res = await page.goto("/herramientas/comprobador");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Comprobador de tokens y enlaces" })).toBeVisible();

  await page.getByLabel("Contrato o enlace").fill(USDC);
  await page.getByRole("button", { name: "Comprobar" }).click();
  await expect(page).toHaveURL(/\/herramientas\/comprobador\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe(USDC);
  expect(url.searchParams.get("chain")).toBe(String(BASE));

  await expect(page.getByRole("heading", { level: 2, name: "Informe del contrato" })).toBeVisible({ timeout: 30_000 });
  // The report page is never indexed.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // From the local node.
  await expect(row(page, "Contrato")).toHaveText("Tiene código");
  await expect(row(page, "Token")).toHaveText("USD Coin (USDC) · 6 decimales");
  await expect(row(page, "Proxy")).toHaveText("No es un proxy");
  await expect(row(page, "Propietario")).toHaveText("Sin función owner()");
  // From the mock Blockscout.
  await expect(row(page, "Código fuente")).toHaveText("Verificado en Blockscout");
  await expect(row(page, "Funciones con permisos")).toHaveText("mint");
  await expect(row(page, "Creación")).toContainText(MOCK_CREATOR);
  // The creation transaction got a Cloudflare challenge (403): unknown with its reason, never a pass.
  await expect(row(page, "Antigüedad")).toHaveText(/^Desconocido\s*·\s*la fuente bloqueó la consulta$/);
  // DexScreener has no testnets.
  await expect(row(page, "Mercado")).toContainText("Desconocido");

  const summary = page.getByRole("region", { name: "Resumen" });
  await expect(summary.getByRole("list", { name: "No pudimos comprobar" })).toContainText("Antigüedad · la fuente bloqueó la consulta");
  await expect(summary.getByTestId("count-high")).toHaveText("0");
  await expect(summary.getByTestId("count-info")).toHaveText("1");
  await expect(page.getByRole("region", { name: "Alertas" })).toContainText("Funciones con permisos");
  await expect(page.getByText("No es asesoramiento financiero. Comprueba siempre por tu cuenta.")).toBeVisible();

  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
});

test("a punycode link shows its homograph alert (the link is never opened)", async ({ page }) => {
  await page.goto(`/herramientas/comprobador?q=${encodeURIComponent(PUNYCODE_LINK)}`);
  await expect(page.getByRole("heading", { level: 2, name: "Informe del enlace" })).toBeVisible();
  const alerts = page.getByRole("region", { name: "Alertas" });
  await expect(alerts).toContainText("Letras de otros alfabetos");
  await expect(alerts).toContainText("аррӏе.com");
  await expect(page.getByRole("region", { name: "Resumen" }).getByTestId("count-high")).not.toHaveText("0");
  await expect(page.getByText("xn--80ak6aa92e.com", { exact: true })).toBeVisible();
});

test("the API answers a link check with 200 JSON", async ({ request }) => {
  const res = await request.get(`/api/v1/check/link?url=${encodeURIComponent(PUNYCODE_LINK)}`, { headers: { "x-forwarded-for": IP_FREE } });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = (await res.json()) as { version: number; kind: string; report: { ok: boolean; alerts: { code: string }[] }; disclaimer: string };
  expect(body.version).toBe(1);
  expect(body.kind).toBe("link");
  expect(body.report.ok).toBe(true);
  expect(body.report.alerts.map((a) => a.code)).toContain("punycode");
  expect(body.disclaimer).toBe("No es asesoramiento financiero. Comprueba siempre por tu cuenta.");

  // Bad parameters are a 400, never counted.
  const bad = await request.get("/api/v1/check/token?chain=84532&address=0x123", { headers: { "x-forwarded-for": IP_FREE } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_address" });
});

test("with the hourly limit spent (hits seeded in the DB) the API answers 429", async ({ request }) => {
  const db = service();
  for (let i = 0; i < 60; i++) {
    const { error } = await db.rpc("ip_rate_limit_hit", { p_subject: ipSubject(IP_LIMITED), p_bucket: "api_free" });
    expect(error).toBeNull();
  }
  const res = await request.get(`/api/v1/check/link?url=${encodeURIComponent("https://www.elclub.party")}`, { headers: { "x-forwarded-for": IP_LIMITED } });
  expect(res.status()).toBe(429);
  expect(res.headers()["retry-after"]).toBe("3600");
  expect(await res.json()).toEqual({ error: "rate_limited" });

  // Another IP is unaffected.
  const other = await request.get(`/api/v1/check/link?url=${encodeURIComponent("https://www.elclub.party")}`, { headers: { "x-forwarded-for": IP_FREE } });
  expect(other.status()).toBe(200);
});

test("EN keeps the page: the language switch lands on /en/tools/checker and the report is in English", async ({ page }) => {
  await page.goto("/herramientas/comprobador");
  await page.locator('a[hreflang="en"]').first().click();
  await expect(page).toHaveURL(/\/en\/tools\/checker$/);
  await expect(page.getByRole("heading", { level: 1, name: "Token and link checker" })).toBeVisible();

  await page.goto(`/en/tools/checker?q=${USDC}&chain=${BASE}`);
  await expect(page.getByRole("heading", { level: 2, name: "Contract report" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Unknown", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Not financial advice. Always do your own research.")).toBeVisible();
  await page.locator('a[hreflang="es"]').first().click();
  await expect(page).toHaveURL(/\/herramientas\/comprobador/);
});
