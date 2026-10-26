import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { hardhatAccount } from "./chain/shared.mjs";
import { clubPath, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { watchCsp } from "./helpers/csp";
import { service } from "./helpers/f2c";
import { installTestWallet, signInPublic } from "./helpers/wallet";

// Administración (spec 2026-10-26, Task 8): switches, closed registration, maintenance with team access, and the 404,
// through the running server (real status codes and headers). The server runs with SITE_STATE_TTL_MS=0, so every change
// is seen on the next request (the proxy's positive access cache still keeps a grant up to 5 s: revocations retry).
// Wallets: TEST-ONLY Hardhat accounts (public mnemonic). 12 is the listed team wallet «L», 13 a wallet outside the list,
// 19 a brand-new wallet for the closed registration and 10 an existing public account.
test.describe.configure({ mode: "serial" });

const L = hardhatAccount(12);
const OUTSIDER = hardhatAccount(13);
const NEWCOMER = hardhatAccount(19);
const EXISTING = hardhatAccount(10);
const OUR_WALLETS = [L, OUTSIDER, NEWCOMER, EXISTING].map((a) => a.address.toLowerCase());

const PASSWORD = "correct horse battery";
const PASSWORD_2 = "another horse battery";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CHECK_URL = `/api/v1/check/token?chain=84532&address=${USDC_BASE_SEPOLIA}`;
const CRON_SECRET = "e2e-cron-secret";
const BANNER = "Mantenimiento activo: la web está cerrada al público";
const ADMIN_PATH = clubPath("/settings/administracion");
const SHOTS = process.env.ADMIN_SHOTS_DIR;
// Straight to the server, and as behind the PRE tunnel (cloudflared sends X-Forwarded-Proto: https).
const VIA: Array<Record<string, string>> = [{}, { "X-Forwarded-Proto": "https" }];

// A-R1 defaults: everything on, maintenance off.
const SWITCHES_ON = {
  giveaways: true,
  pay: true,
  checker: true,
  vouches: true,
  approvals: true,
  multisend: true,
  gas: true,
  donate: true,
  checkerApi: true,
  registration: true,
};
const MAINTENANCE_OFF = { enabled: false, mode: "default", messageEs: null, messageEn: null, returnAt: null, startsAt: null, endsAt: null };

/** Back to A-R1 and no private rows, with the service role (beforeAll defensively, afterAll for the specs after this one). */
async function restore() {
  const db = service();
  const results = await Promise.all([
    db.from("app_config").update({ value: SWITCHES_ON }).eq("key", "site_switches"),
    db.from("app_config").update({ value: MAINTENANCE_OFF }).eq("key", "maintenance"),
    db.from("maintenance_access_wallets").delete().neq("wallet", ""),
    db.from("maintenance_password").delete().eq("id", true),
    db.from("maintenance_grants").delete().not("auth_user_id", "is", null),
    db.from("registration_holds").delete().not("auth_user_id", "is", null),
  ]);
  for (const r of results) if (r.error) throw new Error(`restore failed: ${r.error.message}`);
}

/** Auth users whose web3 identity is `wallet` (lowercase). */
async function authUsersOf(wallet: string) {
  const { data, error } = await service().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  return data.users.filter((u) => (u.identities ?? []).some((i) => i.provider === "web3" && JSON.stringify(i.identity_data ?? {}).toLowerCase().includes(wallet)));
}

/** Public accounts this spec created (no member row) go, so the specs after it start from the same state as before. */
async function dropOurPublicAccounts() {
  const db = service();
  for (const wallet of OUR_WALLETS) {
    const { data: member } = await db.from("members").select("id").eq("wallet_address", wallet).maybeSingle();
    if (member) continue;
    for (const user of await authUsersOf(wallet)) {
      const { error } = await db.auth.admin.deleteUser(user.id);
      if (error) throw new Error(`deleteUser failed: ${error.message}`);
    }
  }
}

// Expected answers the browser logs as failed loads: the document's own 503/404 and the team panel's first check without a
// session (401 «not_signed_in»). Plus WalletConnect's telemetry, which is not ours.
const IGNORED = [/status of (503|404)/, /status of 401 .*\/api\/team-access/, /pulse\.walletconnect\.org/];
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = `${m.text()} @ ${m.location().url}`;
    if (!IGNORED.some((re) => re.test(text))) browserErrors.push(`console: ${text} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

let admin: BrowserContext;
let adminPage: Page;
let anon: BrowserContext;
let anonPage: Page;
let team: BrowserContext;
let teamPage: Page;
const cspReaders: Array<() => Promise<string[]>> = [];

async function watchedPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  cspReaders.push(await watchCsp(page));
  return page;
}

/**
 * Opt-in captures (ADMIN_SHOTS_DIR) at 375 and 1440 px. Always checked: no horizontal scroll and, on one-screen pages
 * (`oneFill`), at most one Base Blue fill (R2).
 */
async function shot(page: Page, name: string, oneFill = true) {
  if (oneFill) expect(await page.locator(".bg-accent-fill:visible").count(), `${name}: Base Blue fills`).toBeLessThanOrEqual(1);
  const before = page.viewportSize();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} @${width} scrolls sideways`).toBeLessThanOrEqual(0);
    // caret: "initial": Playwright's caret-hiding style would otherwise show up as a hydration mismatch on a fresh page.
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true, caret: "initial" });
  }
  if (before) await page.setViewportSize(before);
}

/** The switch rows in the Administración tab. Turning one off asks first (A-R18); on does not. */
async function setSwitch(name: string, on: boolean) {
  const control = adminPage.getByRole("switch", { name, exact: true });
  await expect(control).toHaveAttribute("aria-checked", on ? "false" : "true");
  await control.click();
  if (!on) await adminPage.getByRole("alertdialog").getByRole("button", { name: "Confirmar" }).click();
  await expect(control).toHaveAttribute("aria-checked", on ? "true" : "false");
}

const section = (id: string) => adminPage.locator(`section[aria-labelledby="${id}"]`);
const maintenanceSection = () => section("admin-maintenance");
const accessSection = () => section("admin-access");
const historySection = () => section("admin-history");

/** Saves the form; a save that lands adds one history line (the status line may already read the same before it). */
async function saveMaintenance(confirm: boolean, lands = true) {
  const before = await historySection().locator("li").count();
  await maintenanceSection().getByRole("button", { name: "Guardar mantenimiento" }).click();
  if (confirm) await adminPage.getByRole("alertdialog").getByRole("button", { name: "Confirmar" }).click();
  if (lands) await expect(historySection().locator("li")).toHaveCount(before + 1);
}

async function setPassword(password: string) {
  await maintenanceSection().getByLabel("Contraseña de mantenimiento").fill(password);
  await maintenanceSection().getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(maintenanceSection().getByText("Contraseña guardada.")).toBeVisible();
}

/** The status headers through the running server (A-R8). */
async function expectStatus(request: APIRequestContext, path: string, kind: "maintenance" | "unavailable", headers: Record<string, string> = {}) {
  const res = await request.get(path, { headers, maxRedirects: 0 });
  expect(res.status(), `${path} ${JSON.stringify(headers)}`).toBe(503);
  const h = res.headers();
  expect(h["cache-control"]).toContain("no-store");
  expect(h["x-robots-tag"]).toContain("noindex");
  if (kind === "maintenance") expect(h["retry-after"]).toMatch(/^\d+$/);
  else expect(h["retry-after"]).toBeUndefined();
  return res;
}

/** Every robots meta of the page says noindex (the non-production layout adds its own besides the page's). */
async function expectNoindex(page: Page) {
  const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((el) => el.getAttribute("content") ?? ""));
  expect(robots.length).toBeGreaterThan(0);
  for (const content of robots) expect(content).toMatch(/noindex/);
}

/** `YYYY-MM-DDTHH:mm` in this machine's zone (the browser's): what a datetime-local input takes. */
function localInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** «Acceso del equipo» on the maintenance page, signing with the context's injected wallet. */
async function teamSignIn(page: Page) {
  await page.getByRole("button", { name: "Acceso del equipo" }).click();
  const region = page.getByRole("region", { name: "Acceso del equipo" });
  await signInPublic(page, region);
  return region;
}

/** Retries a reload until it answers `status`: the proxy may keep a positive access up to 5 s (A-R4). */
async function expectReloadStatus(page: Page, path: string, status: number) {
  await expect(async () => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(status);
  }).toPass({ timeout: 20_000 });
}

test.beforeAll(async ({ browser }) => {
  await restore();
  // Dev compiles a route on its first hit, which can outlast the proxy's 2 s self-fetch: warm the status pages up with
  // the internal header (forging it only shows the status page, A-R7).
  for (const path of ["/status/es/maintenance", "/status/en/maintenance", "/status/es/unavailable", "/status/en/unavailable"]) {
    await fetch(`http://localhost:3000${path}`, { headers: { "x-elclub-status": "1" } });
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  // The SuperAdmin signs in before any maintenance (/foro/login does not pass during one, A-R7).
  admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  trackErrors(admin);
  await loginAs(admin, E2E_SUPER_ADMIN_PK);
  adminPage = await watchedPage(admin);
  await adminPage.goto(ADMIN_PATH);
  await expect(adminPage.getByRole("heading", { name: "Administración", level: 2 })).toBeVisible();
  // Reduced motion: the pages render their final, static state (scroll reveals included), as captures need.
  anon = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  trackErrors(anon);
  anonPage = await watchedPage(anon);
});

test.afterAll(async () => {
  // try/finally: a failing restore() must not skip the account cleanup nor leave the contexts open.
  try {
    await restore();
  } finally {
    try {
      await dropOurPublicAccounts();
    } finally {
      await Promise.all([admin?.close(), anon?.close(), team?.close()]);
    }
  }
});

test("1. a switched-off tool: history line, dimmed hub card, 503 page in ES and EN with real headers", async ({ request }) => {
  await setSwitch("Gas", false);
  await expect(historySection()).toContainText("Desactivó «Gas»");

  await anonPage.goto("/herramientas");
  const tools = anonPage.getByRole("list", { name: "Herramientas" });
  await expect(tools.getByRole("link", { name: /Calculadora de gas/ })).toHaveCount(0);
  await expect(tools.locator("li", { hasText: "Calculadora de gas" })).toContainText("No disponible ahora");
  await expect(tools.getByRole("link")).toHaveCount(6);
  await shot(anonPage, "hub-gas-off");

  const res = await anonPage.goto("/herramientas/gas");
  expect(res?.status()).toBe(503);
  await expect(anonPage.getByRole("heading", { name: "Esta herramienta no está disponible ahora" })).toBeVisible();
  await expect(anonPage.getByRole("link", { name: "Ver herramientas" })).toHaveAttribute("href", "/herramientas");
  await shot(anonPage, "unavailable-es");

  const en = await anonPage.goto("/en/tools/gas");
  expect(en?.status()).toBe(503);
  await expect(anonPage.getByRole("heading", { name: "This tool isn't available right now" })).toBeVisible();
  await shot(anonPage, "unavailable-en");

  for (const headers of VIA) {
    const page = await expectStatus(request, "/herramientas/gas", "unavailable", headers);
    expect(await page.text()).toContain("Esta herramienta no está disponible ahora");
  }
});

test("2. the landing drops every link to a switched-off tool", async () => {
  await setSwitch("Avales", false);
  await anonPage.goto("/");
  await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(anonPage.locator('a[href="/herramientas/avales"]')).toHaveCount(0);
  await shot(anonPage, "landing-vouches-gas-off", false);
});

test("3. the checker API answers 503 «unavailable» before x402, then everything goes back on", async ({ request }) => {
  await setSwitch("API del comprobador", false);
  const res = await request.get(CHECK_URL, { headers: { "x-forwarded-for": "203.0.113.81" } });
  expect(res.status()).toBe(503);
  expect(await res.json()).toEqual({ error: "unavailable" });
  expect(res.headers()["payment-required"]).toBeUndefined();
  expect(res.headers()["cache-control"]).toContain("no-store");

  for (const name of ["API del comprobador", "Avales", "Gas"]) await setSwitch(name, true);
  expect((await anonPage.goto("/herramientas/gas"))?.status()).toBe(200);
});

test("4. closed registration: a new wallet is refused and leaves no account; an existing public account still signs in", async ({ browser }) => {
  // The existing account is made while registration is open.
  const existing = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  trackErrors(existing);
  await installTestWallet(existing, { address: EXISTING.address });
  const existingPage = await existing.newPage();
  await existingPage.goto("/herramientas");
  await signInPublic(existingPage, existingPage.getByRole("banner"));
  const account = existingPage.getByRole("group", { name: "Tu cuenta" });
  await expect(account.getByRole("button", { name: "Desconectar" })).toBeVisible();
  await account.getByRole("button", { name: "Desconectar" }).click();
  await expect(existingPage.getByRole("banner").getByRole("button", { name: "Conectar wallet" })).toBeVisible();

  await setSwitch("Registro de cuentas públicas", false);

  const newcomer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  trackErrors(newcomer);
  await installTestWallet(newcomer, { address: NEWCOMER.address });
  const page = await newcomer.newPage();
  await page.goto("/herramientas");
  await signInPublic(page, page.getByRole("banner"));
  await expect(page.getByText("El registro de cuentas está cerrado ahora.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("group", { name: "Tu cuenta" })).toHaveCount(0);
  expect(await authUsersOf(NEWCOMER.address.toLowerCase())).toEqual([]);
  await newcomer.close();

  // The account made before the switch went off is not a new registration: it signs in as usual.
  await existingPage.reload();
  await signInPublic(existingPage, existingPage.getByRole("banner"));
  await expect(existingPage.getByRole("group", { name: "Tu cuenta" }).getByRole("button", { name: "Desconectar" })).toBeVisible({ timeout: 30_000 });
  await existing.close();

  await setSwitch("Registro de cuentas públicas", true);
});

test("5. the SuperAdmin sets the password, lists L and turns the default maintenance on", async () => {
  await setPassword(PASSWORD);
  await accessSection().getByLabel("Wallet").fill(L.address);
  await accessSection().getByLabel("Nota (opcional)").fill("Equipo e2e");
  await accessSection().getByRole("button", { name: "Añadir" }).click();
  await expect(accessSection()).toContainText("Equipo e2e");

  await maintenanceSection().getByLabel("Por defecto").check();
  await maintenanceSection().getByLabel("Activar ahora").check();
  await saveMaintenance(true);
  await expect(maintenanceSection()).toContainText("Activo ahora");
  await expect(historySection()).toContainText("Activó el mantenimiento");
});

test("6. anonymous visitors get the 503 maintenance page (ES / EN) and the API its JSON, with real headers", async ({ request }) => {
  const res = await anonPage.goto("/");
  expect(res?.status()).toBe(503);
  const h = res!.headers();
  expect(h["retry-after"]).toBe("3600");
  expect(h["x-robots-tag"]).toContain("noindex");
  expect(h["cache-control"]).toContain("no-store");
  await expect(anonPage.getByRole("heading", { name: "Volvemos enseguida" })).toBeVisible();
  await expectNoindex(anonPage);

  const en = await anonPage.goto("/en");
  expect(en?.status()).toBe(503);
  await expect(anonPage.getByRole("heading", { name: "Back shortly" })).toBeVisible();

  for (const headers of VIA) {
    for (const path of ["/", "/en", "/herramientas", clubPath()]) {
      const page = await expectStatus(request, path, "maintenance", headers);
      expect(page.headers()["retry-after"]).toBe("3600");
    }
  }

  const api = await request.get(CHECK_URL, { headers: { "x-forwarded-for": "203.0.113.82" } });
  expect(api.status()).toBe(503);
  expect(await api.json()).toEqual({ error: "maintenance" });
  expect(api.headers()["payment-required"]).toBeUndefined();
});

test("7. the crons still answer during maintenance", async ({ request }) => {
  const res = await request.post("/api/cron/dao", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
});

test("8. a wallet outside the list signs in on the maintenance page and is told it has no access", async ({ browser }) => {
  const outsider = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  trackErrors(outsider);
  await installTestWallet(outsider, { address: OUTSIDER.address });
  const page = await watchedPage(outsider);
  expect((await page.goto("/herramientas"))?.status()).toBe(503);
  const region = await teamSignIn(page);
  await expect(region.getByRole("alert")).toHaveText("Esta wallet no tiene acceso durante el mantenimiento.");
  expect((await page.reload())?.status()).toBe(503);
  await outsider.close();
});

test("9. L: wrong password is refused, the right one opens the site with the strip", async ({ browser }) => {
  team = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  trackErrors(team);
  await installTestWallet(team, { address: L.address });
  teamPage = await watchedPage(team);
  expect((await teamPage.goto("/herramientas"))?.status()).toBe(503);
  const region = await teamSignIn(teamPage);
  const password = region.getByLabel("Contraseña de mantenimiento");
  await expect(password).toBeFocused();
  await shot(teamPage, "maintenance-default-password");

  await password.fill("otra contraseña");
  await region.getByRole("button", { name: "Entrar" }).click();
  await expect(region.getByRole("alert")).toHaveText("Contraseña incorrecta.");
  expect((await anonPage.goto("/herramientas"))?.status()).toBe(503);

  await password.fill(PASSWORD);
  await region.getByRole("button", { name: "Entrar" }).click();
  await teamPage.waitForLoadState("load");
  await expect(teamPage.getByRole("heading", { level: 1, name: "Herramientas" })).toBeVisible({ timeout: 30_000 });
  await expect(teamPage.getByText(BANNER)).toBeVisible();
  expect((await teamPage.reload())?.status()).toBe(200);
  await expect(teamPage.getByText(BANNER)).toBeVisible();
  // The content of /herramientas, not only its static shell: the grid streams under <Suspense>.
  await expect(teamPage.getByRole("list", { name: "Herramientas" }).getByRole("link")).toHaveCount(7);
  await shot(teamPage, "banner-tools");
});

test("10. the SuperAdmin, who only signed, gets in with the strip", async () => {
  const page = await watchedPage(admin);
  const res = await page.goto("/herramientas");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Herramientas" })).toBeVisible();
  await expect(page.getByText(BANNER)).toBeVisible();
  await page.close();
  await adminPage.reload();
  await expect(adminPage.getByText(BANNER)).toBeVisible();
  // The tab itself streams under <Suspense>: wait for it before the capture.
  await expect(adminPage.getByRole("heading", { name: "Administración", level: 2 })).toBeVisible();
  await shot(adminPage, "admin-tab-maintenance", false);
});

test("11. a new password puts L out; L enters again with it; removing L puts L out again", async () => {
  await setPassword(PASSWORD_2);
  await expectReloadStatus(teamPage, "/herramientas", 503);

  const region = await (async () => {
    await teamPage.getByRole("button", { name: "Acceso del equipo" }).click();
    return teamPage.getByRole("region", { name: "Acceso del equipo" });
  })();
  await region.getByLabel("Contraseña de mantenimiento").fill(PASSWORD_2);
  await region.getByRole("button", { name: "Entrar" }).click();
  await expect(teamPage.getByText(BANNER)).toBeVisible({ timeout: 30_000 });

  await accessSection().getByRole("button", { name: /^Quitar / }).click();
  await expect(accessSection()).not.toContainText("Equipo e2e");
  await expectReloadStatus(teamPage, "/herramientas", 503);
});

test("12. a custom maintenance shows its own message and return time, and Retry-After follows it", async ({ request }) => {
  // datetime-local has minute precision: start near the top of a minute so +2 h truncated stays within 60 s of 7200.
  const second = new Date().getSeconds();
  if (second > 45) await adminPage.waitForTimeout((61 - second) * 1000);
  const returnAt = Date.now() + 2 * 3600_000;

  await maintenanceSection().getByLabel("Personalizado").check();
  await maintenanceSection().getByLabel("Mensaje en español").fill("Volvemos a las 18:00 con novedades");
  await maintenanceSection().getByLabel("Mensaje en inglés").fill("Back at 6pm with news");
  await maintenanceSection().getByLabel("Vuelta estimada").fill(localInput(returnAt));
  await saveMaintenance(true);
  await expect(maintenanceSection()).toContainText("Activo ahora");

  const res = await anonPage.goto("/en");
  expect(res?.status()).toBe(503);
  await expect(anonPage.getByText("Back at 6pm with news")).toBeVisible();
  await expect(anonPage.getByText(/Estimated return:/)).toBeVisible();
  const retry = Number(res!.headers()["retry-after"]);
  expect(retry).toBeGreaterThanOrEqual(7100);
  expect(retry).toBeLessThanOrEqual(7200);
  await shot(anonPage, "maintenance-custom-en");

  expect(await (await expectStatus(request, "/", "maintenance")).text()).toContain("Volvemos a las 18:00 con novedades");

  // The team panel over the custom page (anonymous: the wallet step).
  await anonPage.goto("/");
  await anonPage.getByRole("button", { name: "Acceso del equipo" }).click();
  await expect(anonPage.getByRole("region", { name: "Acceso del equipo" })).toBeVisible();
  await shot(anonPage, "maintenance-custom-team-sign");
});

test("13. a scheduled window that already started keeps the site closed; an end in the past cannot be saved", async () => {
  const now = Date.now();
  await maintenanceSection().getByLabel("Activar ahora").uncheck();
  await maintenanceSection().getByLabel("Empieza").fill(localInput(now - 60_000));
  await maintenanceSection().getByLabel("Termina").fill(localInput(now + 3600_000));
  await saveMaintenance(true);
  await expect(maintenanceSection()).toContainText("Activo ahora");
  expect((await anonPage.goto("/"))?.status()).toBe(503);

  await maintenanceSection().getByLabel("Empieza").fill(localInput(now - 3 * 60_000));
  await maintenanceSection().getByLabel("Termina").fill(localInput(now - 2 * 60_000));
  await saveMaintenance(false, false);
  // The RPC refuses the past end and the form names the date it refused.
  await expect(maintenanceSection().getByRole("alert")).toContainText("El fin ya ha pasado (");
  expect((await anonPage.goto("/"))?.status()).toBe(503);
});

test("14. turning maintenance off lets everyone in and the strip goes", async () => {
  await maintenanceSection().getByRole("button", { name: "Desactivar mantenimiento" }).click();
  await expect(maintenanceSection()).toContainText("Apagado");
  const res = await anonPage.goto("/");
  expect(res?.status()).toBe(200);
  await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(anonPage.getByText(BANNER)).toHaveCount(0);
  expect((await teamPage.goto("/herramientas"))?.status()).toBe(200);
  await expect(teamPage.getByText(BANNER)).toHaveCount(0);
  await adminPage.reload();
  await expect(adminPage.getByRole("heading", { name: "Administración", level: 2 })).toBeVisible();
  await expect(adminPage.getByText(BANNER)).toHaveCount(0);
});

test("15. the custom 404 in ES, EN and the forum, with a 404 status and noindex", async () => {
  // An unknown top-level segment is the custom 404 for an anonymous visitor too, not the forum login (I1).
  const es = await anonPage.goto("/no-existe-nada");
  expect(es?.status()).toBe(404);
  expect(new URL(anonPage.url()).pathname).toBe("/no-existe-nada");
  await expect(anonPage.getByRole("heading", { name: "Aquí no hay nada" })).toBeVisible();
  await expect(anonPage.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  await expectNoindex(anonPage);
  await shot(anonPage, "404-es");

  const en = await anonPage.goto("/en/nothing/here");
  expect(en?.status()).toBe(404);
  await expect(anonPage.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  await expectNoindex(anonPage);
  await shot(anonPage, "404-en");

  const page = await watchedPage(admin);
  const foro = await page.goto(clubPath("/no-existe"));
  expect(foro?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Este rincón del foro no existe" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al foro" })).toHaveAttribute("href", clubPath());
  await expectNoindex(page);
  await shot(page, "404-foro");
  await page.close();
});

test("16. no console errors and no CSP violations on the way", async () => {
  const violations = (await Promise.all(cspReaders.map((read) => read()))).flat();
  expect(violations).toEqual([]);
  expect(browserErrors).toEqual([]);
});
