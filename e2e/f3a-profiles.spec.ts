import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { channelIds, createInvite, messageWith, openChannel, rpcAs, sendMention, service } from "./helpers/f2c";
import { privateKeyToAccount } from "viem/accounts";

// F3a acceptance: mandatory-handle welcome, profile editing, mentions by @handle, SuperAdmin economy settings,
// non-admin protection and the guide. Generated test wallets only. The DB is reset by global-setup; scenarios share
// state, so run serially.
test.describe.configure({ mode: "serial" });

const keyM = newWalletKey(); // newcomer, goes through the welcome
const keyP = newWalletKey(); // plain member for the non-admin checks

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
let browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}
test.afterEach(() => {
  // Test 5 requests /settings/economia as a non-admin on purpose: the browser logs the deliberate 404 document.
  const expected404 = (e: string) => /status of 404/.test(e) && e.includes("@ http://localhost:3000/settings/economia ");
  // Reown AppKit re-fetches the page URL to check its COOP header; on a real 404 document it logs this line.
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  const errors = browserErrors.filter((e) => !expected404(e) && !coopOn404(e));
  browserErrors = [];
  expect(errors, "browser console errors").toEqual([]);
});

const HANDLE = "ray_test1";
const BADGE = "MODO PRUEBA · Linea Sepolia";
const desktop = { width: 1280, height: 900 };

let admin: BrowserContext;
let adminPage: Page;
let member: BrowserContext;
let memberPage: Page;
let plain: BrowserContext;
let generalId = "";

test.beforeAll(async ({ browser }) => {
  admin = await browser.newContext({ viewport: desktop });
  trackErrors(admin);
  await loginAs(admin, E2E_SUPER_ADMIN_PK);
  adminPage = await admin.newPage();
  generalId = (await channelIds())["General"]!;

  member = await browser.newContext({ viewport: desktop });
  trackErrors(member);
  await loginAs(member, keyM, { invite: await createInvite(adminPage), onboard: false });
  memberPage = await member.newPage();

  plain = await browser.newContext({ viewport: desktop });
  trackErrors(plain);
  await loginAs(plain, keyP, { invite: await createInvite(adminPage) });
});

test.afterAll(async () => {
  await admin?.close();
  await member?.close();
  await plain?.close();
});

test("1. newcomer without a handle is sent to the welcome, must pick a handle and returns to where they were going", async () => {
  const p = memberPage;
  await p.goto(`/c/${generalId}`);
  await expect(p).toHaveURL(new RegExp(`/bienvenida\\?next=`));
  expect(decodeURIComponent(new URL(p.url()).searchParams.get("next") ?? "")).toBe(`/c/${generalId}`);

  await expect(p.getByRole("heading", { level: 2, name: "Elige tu @handle" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Saltar" })).toHaveCount(0);

  const input = p.getByRole("textbox", { name: "@handle" });
  // The server-rendered input is visible before React hydrates; a fill() in that window is wiped by hydration and no
  // validation runs. Retry the fill until the hydrated form answers with the reserved-name alert.
  await expect(async () => {
    await input.fill("ADMIN");
    await expect(p.getByRole("alert").filter({ hasText: "Ese nombre está reservado" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(p.getByRole("button", { name: "Siguiente" })).toBeDisabled();

  await input.fill(HANDLE);
  await p.getByRole("button", { name: "Siguiente" }).click();
  await expect(p.getByRole("heading", { level: 2, name: "Propinas y bounties" })).toBeVisible();
  await p.getByRole("button", { name: "Saltar" }).click();

  await expect(p).toHaveURL(new RegExp(`/c/${generalId}$`));
  await expect(p.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
});

test("2. profile: bio, links and avatar show on the public page, hostile domains go through /out", async () => {
  const p = memberPage;
  await p.goto("/perfil");
  await expect(p.getByRole("heading", { level: 1, name: "Editar perfil" })).toBeVisible();
  await p.waitForLoadState("networkidle");

  await p.getByLabel("Elegir imagen de perfil").setInputFiles("e2e/fixtures/avatar.png");
  await expect(p.getByRole("button", { name: "Quitar foto" })).toBeVisible();

  await p.getByLabel("Bio").fill("Construyo cosas en la red de pruebas.");
  await p.getByRole("button", { name: "Añadir enlace" }).click();
  await p.getByRole("textbox", { name: "Enlace 1", exact: true }).fill("https://github.com/x");
  await p.getByRole("button", { name: "Añadir enlace" }).click();
  await p.getByRole("textbox", { name: "Enlace 2", exact: true }).fill("https://evil.example");
  await p.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(p.getByText("Perfil guardado.")).toBeVisible();

  await p.goto(`/u/${HANDLE}`);
  await expect(p.locator('main img[src*="/avatars/"]').first()).toBeVisible();
  await expect(p.getByText("Construyo cosas en la red de pruebas.")).toBeVisible();
  const github = p.locator('main a[href="https://github.com/x"]');
  await expect(github).toBeVisible();
  const evil = p.locator('main a[href^="/out?u="]');
  await expect(evil).toHaveCount(1);
  expect(decodeURIComponent((await evil.getAttribute("href"))!)).toContain("https://evil.example");
});

test("3. a mention of the member renders @handle", async () => {
  const p = adminPage;
  await p.goto(`/c/${generalId}`);
  await openChannel(p, "General");
  await sendMention(p, HANDLE, " bienvenido al club");
  const msg = messageWith(p, "bienvenido al club");
  await expect(msg).toBeVisible();
  await expect(msg.getByText(`@${HANDLE}`).first()).toBeVisible();
});

test("4. SuperAdmin sets fee and addresses, switches network and members see the badge change", async () => {
  const p = adminPage;
  await p.goto("/settings/economia");
  await expect(p.getByRole("heading", { level: 2, name: "Economía" })).toBeVisible();
  await p.waitForLoadState("networkidle");

  await p.getByLabel("Comisión mínima (%)").fill("2,6");
  await p.getByRole("button", { name: "Guardar comisión" }).click();
  await expect(p.getByText("Comisión guardada.")).toBeVisible();

  await p.getByLabel("Safe (Linea Sepolia)", { exact: true }).fill(privateKeyToAccount(newWalletKey()).address);
  await p.getByLabel("Wallet de la plataforma (Linea Sepolia)", { exact: true }).fill(privateKeyToAccount(newWalletKey()).address);
  await p.getByRole("button", { name: "Guardar direcciones de Linea Sepolia" }).click();
  await expect(p.getByText("Direcciones guardadas.")).toBeVisible();

  // Members see the test-mode badge while Sepolia is active.
  await memberPage.goto("/");
  await expect(memberPage.getByRole("banner").getByText(BADGE)).toBeVisible();

  await p.getByRole("button", { name: "Cambiar a Linea", exact: true }).click();
  const dialog = p.getByRole("alertdialog");
  await expect(dialog.getByText("Los envíos de dinero pasarán a Linea. ¿Continuar?")).toBeVisible();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(p.getByRole("button", { name: "Cambiar a Linea Sepolia" })).toBeVisible();

  await memberPage.goto("/");
  await expect(memberPage.getByRole("banner")).toBeVisible();
  await expect(memberPage.getByText("MODO PRUEBA")).toHaveCount(0);

  // Switch back.
  await p.getByRole("button", { name: "Cambiar a Linea Sepolia" }).click();
  await p.getByRole("alertdialog").getByRole("button", { name: "Continuar" }).click();
  await expect(p.getByRole("button", { name: "Cambiar a Linea", exact: true })).toBeVisible();
  await memberPage.goto("/");
  await expect(memberPage.getByRole("banner").getByText(BADGE)).toBeVisible();

  // The fee persisted as 260 bps.
  const { data } = await service().from("app_config").select("*");
  expect(JSON.stringify(data)).toContain("260");
});

test("5. a non-admin gets 404 on the economy settings and forbidden from the RPCs", async () => {
  const page = await plain.newPage();
  const res = await page.goto("/settings/economia");
  expect(res?.status()).toBe(404);
  await page.close();

  const { error } = await rpcAs(plain, "set_min_fee_bps", { p_bps: 0 });
  expect(error?.message).toContain("forbidden");
});

test("6. the guide lists 7 sections and the palette offers them", async () => {
  const p = memberPage;
  await p.goto("/guia");
  await expect(p.getByRole("heading", { level: 1, name: "Guía" })).toBeVisible();
  // propinas, bounties, dao, fondo (F4a), encuestas (F4e), candados, redes
  await expect(p.locator('main a[href^="/guia/"]')).toHaveCount(7);

  await p.goto("/");
  await p.waitForLoadState("networkidle");
  const dialog = p.getByRole("dialog", { name: "Buscar" });
  await expect(async () => {
    await p.keyboard.press("Control+K");
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await dialog.getByRole("combobox").fill("dao");
  await expect(dialog.getByRole("option", { name: /Guía: DAO y shares/ })).toBeVisible();
});
