import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { addressOf, E2E_SUPER_ADMIN_ADDRESS, E2E_SUPER_ADMIN_PK, handleOf, loginAs, newWalletKey } from "./helpers/auth";

// Acceptance criteria of F1. The DB is reset by global-setup; scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

const adminAddr = E2E_SUPER_ADMIN_ADDRESS.toLowerCase();

const keyB = newWalletKey();
const keyC = newWalletKey();

// Every browser error (console.error, uncaught exceptions) from any context, asserted empty at the end.
// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url}`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

async function actor(browser: Browser, pk: `0x${string}`, invite?: string) {
  const context = await browser.newContext();
  trackErrors(context);
  const landed = await loginAs(context, pk, { invite });
  const page = await context.newPage();
  return { context, page, landed };
}

async function createInvite(page: Page, uses: "1" | "5" = "1"): Promise<{ url: string; code: string }> {
  await page.goto("/invites");
  await page.getByLabel("Usos").selectOption(uses);
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const url = await page.getByLabel("Tu enlace de invitación").inputValue();
  return { url, code: url.split("/invite/")[1]! };
}

let admin: BrowserContext;
let adminPage: Page;

test.beforeAll(async ({ browser }) => {
  ({ context: admin, page: adminPage } = await actor(browser, E2E_SUPER_ADMIN_PK));
});

test.afterAll(async () => {
  await admin?.close();
});

test("1. una wallet sin invitación acaba en /no-access", async ({ browser }) => {
  const { context, page } = await actor(browser, newWalletKey());
  // "/" is the public landing for a signed-in account without membership (P2); forum routes still send it to /no-access.
  await page.goto("/invites");
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.getByRole("heading", { name: "Sin acceso" })).toBeVisible();
  await context.close();
});

test("2. el SuperAdmin entra a / sin invitación", async () => {
  await adminPage.goto("/");
  await expect(adminPage).toHaveURL(/\/$/);
  await expect(adminPage.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "Invitaciones" })).toBeVisible();
});

test("3. el admin invita, B canjea y su perfil muestra al admin como padrino", async ({ browser }) => {
  const { code } = await createInvite(adminPage);
  const { context, page } = await actor(browser, keyB, code);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();

  await page.goto(`/u/${addressOf(keyB)}`);
  const sponsor = page.getByRole("region", { name: "Le invitó" });
  await expect(sponsor.getByRole("link", { name: handleOf(E2E_SUPER_ADMIN_PK) })).toBeVisible();
  await context.close();
});

test("4. una invitación caducada muestra el error de caducidad", async ({ browser }) => {
  const { code } = await createInvite(adminPage);
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await service
    .from("invites")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("code", code);
  expect(error).toBeNull();

  const { context, page, landed } = await actor(browser, newWalletKey(), code);
  await page.goto(landed);
  await expect(page).toHaveURL(/\/invite\/.+error=invite_expired/);
  await expect(page.getByText("Esta invitación ha caducado.")).toBeVisible();
  await context.close();
});

test("5. Padrino -> B invita a C -> ban con penalización: B pierde Invitaciones y su invitación se anula", async ({
  browser,
}) => {
  // Admin grants Padrino to B.
  await adminPage.goto("/admin/members");
  await adminPage.getByRole("button", { name: `Padrino: ${handleOf(keyB)}` }).click();
  await expect(adminPage.getByRole("button", { name: `Padrino: ${handleOf(keyB)}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // B now sees Invitaciones and invites C (multi-use so it stays pending afterwards).
  const b = await actor(browser, keyB);
  await b.page.goto("/");
  await expect(b.page.getByRole("link", { name: "Invitaciones" })).toBeVisible();
  const { code } = await createInvite(b.page, "5");

  const c = await actor(browser, keyC, code);
  await c.page.goto("/");
  await expect(c.page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await c.context.close();

  // Admin bans C penalizing the sponsor.
  await adminPage.goto("/admin/members");
  await adminPage.getByRole("button", { name: `Banear a ${handleOf(keyC)}` }).click();
  await adminPage.getByLabel("Motivo").fill("Spam repetido");
  await adminPage.getByRole("checkbox", { name: /Penalizar también a/ }).click();
  await adminPage.getByRole("button", { name: "Banear", exact: true }).click();
  await expect(adminPage.getByRole("alertdialog")).toBeHidden();
  await expect(adminPage.getByRole("row", { name: new RegExp(handleOf(keyC)) })).toContainText("Baneado");

  // B no longer sees Invitaciones.
  await b.page.goto("/");
  await expect(b.page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await expect(b.page.getByRole("link", { name: "Invitaciones" })).toHaveCount(0);
  await b.context.close();

  // B's pending invite is revoked.
  const d = await actor(browser, newWalletKey(), code);
  await d.page.goto(d.landed);
  await expect(d.page).toHaveURL(/\/invite\/.+error=invite_revoked/);
  await expect(d.page.getByText("Esta invitación fue anulada.")).toBeVisible();
  await d.context.close();
});

test("6. anonymous and member pages render without browser errors", async ({ browser }) => {
  // Anonymous gate pages (these host the wallet panel, which must not break SSR/hydration).
  const anon = await browser.newContext();
  trackErrors(anon);
  const page = await anon.newPage();
  for (const path of ["/login", "/invite/not-a-real-code", "/no-access"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Conectar wallet" })).toBeVisible();
  await anon.close();

  // Member pages as the admin.
  for (const path of ["/", "/invites", "/admin/members", `/u/${adminAddr}`]) {
    await adminPage.goto(path);
    await adminPage.waitForLoadState("networkidle");
  }

  expect(browserErrors).toEqual([]);
});
