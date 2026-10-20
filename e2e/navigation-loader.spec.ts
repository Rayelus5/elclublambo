import { expect, test, type Page } from "@playwright/test";
import { E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";

// T-002 (ronda 1): while a navigation is slow, the content area shows the Diamond loader and the shell stays put; the
// clicked sidebar link shows a small hint while the navigation has not committed.
test.describe.configure({ mode: "serial" });

const DELAY_MS = 3_000;

const isPrefetch = (headers: Record<string, string>) =>
  headers["next-router-prefetch"] !== undefined || headers["next-router-segment-prefetch"] !== undefined;

/**
 * A slow server, deterministically: holds RSC requests for DELAY_MS. `navigations` holds only the navigation request,
 * so the prefetched shell (with its Suspense fallback) is already on the client: the real case of a slow page.
 * `everything` also holds the prefetches, so the click cannot commit until the server answers.
 */
async function slowRsc(page: Page, mode: "navigations" | "everything") {
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (headers["rsc"] === "1" && (mode === "everything" || !isPrefetch(headers))) await new Promise((r) => setTimeout(r, DELAY_MS));
    await route.continue().catch(() => {});
  });
}

/** Opens Inicio and waits until the destination of `link` is prefetched (viewport in prod, hover in dev). */
async function homeWithPrefetch(page: Page, linkName: RegExp, nav: string) {
  const prefetched: string[] = [];
  page.on("response", (res) => {
    if (isPrefetch(res.request().headers())) prefetched.push(new URL(res.url()).pathname);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  const link = page.getByRole("navigation", { name: nav }).first().getByRole("link", { name: linkName });
  const href = (await link.getAttribute("href"))!;
  await link.hover();
  await expect.poll(() => prefetched.some((p) => p === href || p.startsWith(`${href}.`) || p.startsWith(`${href}/`))).toBe(true);
  return link;
}

const main = (page: Page) => page.getByRole("main");
// The content fallback comes from the prefetched static shell, which only a production build serves (dev renders with
// server caches off and prefetches differently). Run these with E2E_PROD=1; the link hint is checked in both modes.
const prodOnly = () => test.skip(process.env.E2E_PROD !== "1", "needs the prerendered shell of a production build (E2E_PROD=1)");
const GENERAL = /^General( sin leer)?$/;

test.beforeEach(async ({ context, page }) => {
  await loginAs(context, E2E_SUPER_ADMIN_PK);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("al cambiar de canal se ve el diamante en el contenido y la barra lateral sigue ahí", async ({ page }) => {
  prodOnly();
  await slowRsc(page, "navigations");
  const link = await homeWithPrefetch(page, GENERAL, "Canales");
  await link.click();

  const loader = main(page).getByRole("status").filter({ hasText: /Cargando/ });
  await expect(loader).toBeVisible();
  const diamond = loader.locator("svg");
  await expect(diamond).toBeVisible();
  // Accent token colour, and a delayed fade-in (no flash on a fast navigation).
  const accent = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(diamond).toHaveCSS("color", accent);
  await expect(diamond).toHaveCSS("animation-name", "loader-in");
  await expect(diamond).toHaveCSS("animation-delay", "0.15s");

  // The shell does not go away while the content loads.
  await expect(page.getByRole("navigation", { name: "Canales" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible({ timeout: 20_000 });
  await expect(loader).toBeHidden();
});

test("al cambiar de sección se ve el diamante en el contenido", async ({ page }) => {
  prodOnly();
  await slowRsc(page, "navigations");
  const link = await homeWithPrefetch(page, /^DAO/, "Principal");
  await link.click();
  const loader = main(page).getByRole("status").filter({ hasText: /Cargando/ });
  await expect(loader.locator("svg")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Canales" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "DAO" })).toBeVisible({ timeout: 20_000 });
  await expect(loader).toBeHidden();
});

test("el enlace pulsado muestra el indicador mientras la navegación no termina", async ({ page }) => {
  await slowRsc(page, "everything");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  const link = page.getByRole("navigation", { name: "Canales" }).getByRole("link", { name: GENERAL });
  await link.click();
  await expect(link.locator('[data-link-pending="true"] svg')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible({ timeout: 20_000 });
  await expect(link.locator('[data-link-pending="false"]')).toHaveCount(1);
});

test("con «reducir movimiento» el diamante aparece quieto", async ({ page }) => {
  prodOnly();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowRsc(page, "navigations");
  const link = await homeWithPrefetch(page, GENERAL, "Canales");
  await link.click();
  const loader = main(page).getByRole("status").filter({ hasText: /Cargando/ });
  await expect(loader.locator("svg")).toBeVisible();
  const pixels = loader.locator("svg rect");
  await expect(pixels).toHaveCount(8);
  for (let i = 0; i < 8; i++) await expect(pixels.nth(i)).toHaveCSS("animation-iteration-count", "1");
  await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible({ timeout: 20_000 });
});
