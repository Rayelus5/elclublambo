import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";

// Acceptance criteria of F2a (channel structure and cascading permissions).
// The DB is reset by global-setup; scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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

async function createInvite(page: Page): Promise<string> {
  await page.goto("/invites");
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const url = await page.getByLabel("Tu enlace de invitación").inputValue();
  return url.split("/invite/")[1]!;
}

const service = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

let admin: BrowserContext;
let adminPage: Page;
let bCtx: BrowserContext;
let bPage: Page;
let vipId = "";

test.beforeAll(async ({ browser }) => {
  ({ context: admin, page: adminPage } = await actor(browser, E2E_SUPER_ADMIN_PK));
  const code = await createInvite(adminPage);
  ({ context: bCtx, page: bPage } = await actor(browser, keyB, code));
  await bPage.goto("/");
});

test.afterAll(async () => {
  await admin?.close();
  await bCtx?.close();
});

// The channel page streams inside <Suspense>, so a notFound() there would already be a 200: the proxy decides
// the 404 before the page renders (src/lib/channels/guard.ts), so the response itself must be a real 404.
const notFoundPaths: string[] = [];
async function expectNotFound(page: Page, path: string) {
  notFoundPaths.push(path);
  const response = await page.goto(path);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
}

const channelsNav = (page: Page) => page.getByRole("navigation", { name: "Canales" });

test("1. el admin ve el árbol semilla en la barra lateral", async () => {
  await adminPage.goto("/");
  const nav = channelsNav(adminPage);
  for (const name of ["Comunidad", "Mercado", "Ayuda"]) {
    // Categories render as collapsible buttons ("Ayuda" is also a text channel, hence the role).
    await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "General", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Trading", exact: true })).toBeVisible();
});

test("2. VIP bajo Comunidad con VIEW denegado a @everyone: B no lo ve y /c/<vip> da 404", async () => {
  await adminPage.goto("/settings/channels");
  await adminPage.getByRole("button", { name: "Nuevo en Comunidad" }).click();
  const dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("Tipo").selectOption("text");
  await dialog.getByLabel("Nombre").fill("VIP");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(dialog).toBeHidden();

  await adminPage.getByRole("button", { name: "Editar VIP" }).click();
  const matrix = adminPage.getByRole("region", { name: "Permisos de VIP" });
  await expect(matrix).toBeVisible();
  await matrix.getByLabel("Añadir rol").selectOption({ label: "@everyone" });
  const viewEveryone = matrix.getByRole("button", { name: /^@everyone · Ver canal:/ });
  await viewEveryone.click(); // heredar -> permitido
  await viewEveryone.click(); // permitido -> denegado
  await expect(viewEveryone).toHaveAccessibleName("@everyone · Ver canal: denegado");
  const save = matrix.getByRole("button", { name: "Guardar @everyone" });
  await save.click();
  await expect(save).toBeDisabled();

  const { data, error } = await service().from("channels").select("id").eq("name", "VIP").single<{ id: string }>();
  expect(error).toBeNull();
  vipId = data!.id;

  await bPage.goto("/");
  await expect(channelsNav(bPage).getByRole("link", { name: "General", exact: true })).toBeVisible();
  await expect(channelsNav(bPage).getByRole("link", { name: "VIP", exact: true })).toHaveCount(0);

  await expectNotFound(bPage, `/c/${vipId}`);
});

test("3. un overwrite de miembro con VIEW permitido hace visible VIP para B", async () => {
  const bAddr = addressOf(keyB);
  await adminPage.goto("/settings/channels");
  await adminPage.getByRole("button", { name: "Editar VIP" }).click();
  const matrix = adminPage.getByRole("region", { name: "Permisos de VIP" });
  await matrix.getByLabel("Añadir miembro").fill(bAddr);
  await matrix.getByRole("button", { name: "Buscar" }).click();
  await matrix.getByRole("button", { name: new RegExp(short(bAddr)) }).click();

  const viewB = matrix.getByRole("button", { name: new RegExp(`^${short(bAddr)} · Ver canal:`) });
  await viewB.click(); // heredar -> permitido
  await expect(viewB).toHaveAccessibleName(`${short(bAddr)} · Ver canal: permitido`);
  const save = matrix.getByRole("button", { name: `Guardar ${short(bAddr)}` });
  await save.click();
  await expect(save).toBeDisabled();

  await bPage.goto("/");
  await expect(channelsNav(bPage).getByRole("link", { name: "VIP", exact: true })).toBeVisible();
  await bPage.goto(`/c/${vipId}`);
  await expect(bPage.getByRole("heading", { name: /VIP/ })).toBeVisible();
});

test("4. un Moderador verifica a C desde Miembros y aparece el badge", async ({ browser }) => {
  // There is no UI to assign arbitrary roles yet (F1 only toggles Padrino): grant Moderador to B
  // directly with the service-role client. B's permissions are read from the DB on every request.
  const db = service();
  const { data: role, error: roleError } = await db
    .from("roles")
    .select("id")
    .eq("name", "Moderador")
    .single<{ id: string }>();
  expect(roleError).toBeNull();
  const { data: member, error: memberError } = await db
    .from("members")
    .select("id")
    .eq("wallet_address", addressOf(keyB))
    .single<{ id: string }>();
  expect(memberError).toBeNull();
  const { error: grantError } = await db.from("member_roles").insert({ member_id: member!.id, role_id: role!.id });
  expect(grantError).toBeNull();

  const code = await createInvite(adminPage);
  const { context: cCtx, page: cPage } = await actor(browser, keyC, code);
  await cPage.goto("/");
  await cCtx.close();

  const cShort = short(addressOf(keyC));
  await bPage.goto("/admin/members");
  const toggle = bPage.getByRole("button", { name: `Verificado: ${cShort}` });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const row = bPage.getByRole("row", { name: new RegExp(cShort) });
  // The row also holds the toggle button whose label is "Verificado": target the badge span only.
  await expect(row.locator("span", { hasText: /^Verificado$/ })).toBeVisible();
});

test("5. /c/<uuid aleatorio> y /c/not-a-uuid dan 404", async () => {
  await expectNotFound(bPage, "/c/6f1c1c5e-0000-4000-8000-0000000000aa");
  await expectNotFound(bPage, "/c/not-a-uuid");
});

test("6. sin errores de consola en las páginas nuevas", async () => {
  for (const path of ["/settings/channels", "/settings/roles", "/settings/links", "/admin/members", "/"]) {
    await adminPage.goto(path);
    await adminPage.waitForLoadState("networkidle");
  }
  await bPage.goto(`/c/${vipId}`);
  await bPage.waitForLoadState("networkidle");
  // A text channel mounts the realtime chat (history log + composer).
  await adminPage.goto("/");
  await channelsNav(adminPage).getByRole("link", { name: "General", exact: true }).click();
  await expect(adminPage.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
  await expect(adminPage.getByRole("textbox", { name: "Mensaje" })).toBeVisible();
  await adminPage.waitForLoadState("networkidle");
  // The only tolerated errors are the browser's own "Failed to load resource ... 404" lines for the documents
  // this spec deliberately requested as missing channels.
  const expected404 = (e: string) =>
    /status of 404/.test(e) && [...notFoundPaths, `/c/${vipId}`].some((path) => e.endsWith(`@ http://localhost:3000${path}`));
  // Reown AppKit re-fetches the page URL to check its COOP header; on a real 404 document it logs this line.
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  const unexpected = browserErrors.filter((e) => !expected404(e) && !coopOn404(e));
  expect(unexpected).toEqual([]);
});
