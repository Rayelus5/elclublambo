import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";

// Acceptance of F2b beyond the live-view scenarios in f2b-chat-view.spec.ts: roles and read-only channels,
// slowmode, the link guard, visibility of realtime events, Alpha and the CSP. The DB is reset by global-setup;
// scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

const keyB = newWalletKey();
const keyMod = newWalletKey();

const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error") browserErrors.push(`console: ${m.text()} @ ${m.location().url}`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

async function actor(browser: Browser, pk: `0x${string}`, invite?: string) {
  const context = await browser.newContext();
  trackErrors(context);
  await loginAs(context, pk, { invite });
  const page = await context.newPage();
  return { context, page };
}

const service = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

let admin: BrowserContext;
let adminPage: Page;
let bCtx: BrowserContext;
let bPage: Page;
let modCtx: BrowserContext;
let modPage: Page;
const ids: Record<string, string> = {};

const channelsNav = (page: Page) => page.getByRole("navigation", { name: "Canales" });
const openChannel = async (page: Page, name: string) => {
  await channelsNav(page).getByRole("link", { name: new RegExp(`^${name}( sin leer)?$`) }).click();
  // the log of the previous channel is still mounted until the navigation lands
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
};
const composer = (page: Page) => page.getByRole("textbox", { name: "Mensaje", exact: true });
const send = async (page: Page, text: string) => {
  await composer(page).click();
  await composer(page).fill(text);
  await composer(page).press("Enter");
};
const messageWith = (page: Page, text: string) => page.locator("li[data-message-id]", { hasText: text }).first();

async function createInvite(page: Page): Promise<string> {
  await page.goto("/invites");
  await page.getByRole("button", { name: "Crear invitación" }).click();
  const url = await page.getByLabel("Tu enlace de invitación").inputValue();
  return url.split("/invite/")[1]!;
}

test.beforeAll(async ({ browser }) => {
  ({ context: admin, page: adminPage } = await actor(browser, E2E_SUPER_ADMIN_PK));
  ({ context: bCtx, page: bPage } = await actor(browser, keyB, await createInvite(adminPage)));
  ({ context: modCtx, page: modPage } = await actor(browser, keyMod, await createInvite(adminPage)));

  // There is no UI to hand out arbitrary roles yet: make the third member a Moderador (EMBED_LINKS,
  // MANAGE_MESSAGES, can post in read-only channels) with the service-role client.
  const db = service();
  const role = await db.from("roles").select("id").eq("name", "Moderador").single<{ id: string }>();
  const modMember = await db.from("members").select("id").eq("wallet_address", addressOf(keyMod)).single<{ id: string }>();
  expect(role.error).toBeNull();
  expect(modMember.error).toBeNull();
  const grant = await db.from("member_roles").insert({ member_id: modMember.data!.id, role_id: role.data!.id });
  expect(grant.error).toBeNull();

  const channels = await db.from("channels").select("id, name");
  for (const c of (channels.data ?? []) as Array<{ id: string; name: string }>) ids[c.name] = c.id;

  // A slow channel and a hidden one (VIEW denied to @everyone, allowed to the SuperAdmin role).
  const everyone = await db.from("roles").select("id").eq("is_everyone", true).single<{ id: string }>();
  const superAdmin = await db.from("roles").select("id").eq("name", "SuperAdmin").single<{ id: string }>();
  const slow = await db
    .from("channels")
    .insert({ parent_id: ids["Comunidad"], kind: "text", name: "Lento", position: 20, slowmode_seconds: 5 })
    .select("id")
    .single<{ id: string }>();
  expect(slow.error).toBeNull();
  ids["Lento"] = slow.data!.id;
  const hidden = await db
    .from("channels")
    .insert({ parent_id: ids["Comunidad"], kind: "text", name: "Secreto", position: 21 })
    .select("id")
    .single<{ id: string }>();
  expect(hidden.error).toBeNull();
  ids["Secreto"] = hidden.data!.id;
  const ow = await db.from("permission_overwrites").insert([
    { channel_id: ids["Secreto"], target_type: "role", target_id: everyone.data!.id, allow: 0, deny: 1 },
    { channel_id: ids["Secreto"], target_type: "role", target_id: superAdmin.data!.id, allow: 1, deny: 0 },
  ]);
  expect(ow.error).toBeNull();

  for (const p of [adminPage, bPage, modPage]) await p.goto("/");
});

test.afterAll(async () => {
  await admin?.close();
  await bCtx?.close();
  await modCtx?.close();
});

test("1. B publica en General y A lo ve sin recargar; A responde en hilo y B ve el contador", async () => {
  await openChannel(adminPage, "General");
  await openChannel(bPage, "General");
  await send(bPage, "mensaje de B");
  await expect(messageWith(bPage, "mensaje de B")).toBeVisible();
  await expect(messageWith(adminPage, "mensaje de B")).toBeVisible();

  await messageWith(adminPage, "mensaje de B").getByRole("button", { name: "Acciones del mensaje" }).click();
  await adminPage.getByRole("menuitem", { name: "Responder en hilo" }).click();
  const panel = adminPage.getByRole("complementary", { name: "Panel del hilo" });
  const box = panel.getByRole("textbox", { name: "Mensaje", exact: true });
  await box.click();
  await box.fill("respuesta de A");
  await box.press("Enter");
  await expect(panel.getByText("respuesta de A")).toBeVisible();
  await expect(messageWith(bPage, "mensaje de B").getByRole("button", { name: "1 respuesta" })).toBeVisible();
  await panel.getByRole("button", { name: "Cerrar hilo" }).click();
});

test("2. B edita su mensaje (muestra «editado», también al otro) y lo borra", async () => {
  await messageWith(bPage, "mensaje de B").getByRole("button", { name: "Acciones del mensaje" }).click();
  await bPage.getByRole("menuitem", { name: "Editar" }).click();
  const edit = bPage.getByRole("textbox", { name: "Editar mensaje" });
  await edit.press("ControlOrMeta+a");
  await edit.pressSequentially("B corregido");
  await edit.press("Enter");
  await expect(messageWith(bPage, "B corregido").getByText("editado", { exact: true })).toBeVisible();
  await expect(messageWith(adminPage, "B corregido").getByText("editado", { exact: true })).toBeVisible();

  // a message with replies is only soft-deleted: use a fresh one to check the hard delete
  await send(bPage, "efímero");
  await expect(messageWith(adminPage, "efímero")).toBeVisible();
  await messageWith(bPage, "efímero").getByRole("button", { name: "Acciones del mensaje" }).click();
  await bPage.getByRole("menuitem", { name: "Borrar" }).click();
  await bPage.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(bPage.getByText("efímero")).toHaveCount(0);
  await expect(adminPage.getByText("efímero")).toHaveCount(0);
});

test("3. Reglas es de solo lectura para B (sin compositor) y el moderador sí publica", async () => {
  await openChannel(bPage, "Reglas");
  await expect(bPage.getByText("Este canal es de solo lectura.")).toBeVisible();
  await expect(composer(bPage)).toHaveCount(0);

  await openChannel(modPage, "Reglas");
  await expect(composer(modPage)).toBeVisible();
  await send(modPage, "norma número uno");
  await expect(messageWith(modPage, "norma número uno")).toBeVisible();
  await expect(messageWith(bPage, "norma número uno")).toBeVisible();
  await expect(composer(bPage)).toHaveCount(0);
});

test("4. slowmode de 5 s: el segundo mensaje de B muestra la cuenta atrás y luego se envía", async () => {
  await bPage.goto("/");
  await openChannel(bPage, "Lento");
  await send(bPage, "uno");
  await expect(messageWith(bPage, "uno")).toBeVisible();
  await expect(bPage.getByText(/Puedes escribir de nuevo en \d+s/)).toBeVisible();

  await send(bPage, "dos");
  await expect(bPage.getByText("Espera a que termine el tiempo de espera del canal")).toBeVisible();
  await expect(bPage.getByText(/Puedes escribir de nuevo en \d+s/)).toBeVisible();
  await expect(messageWith(bPage, "dos")).toHaveCount(0);

  // the countdown ends (database clock) and the draft can be sent
  await expect(bPage.getByText(/Puedes escribir de nuevo en/)).toHaveCount(0, { timeout: 15_000 });
  await composer(bPage).press("Enter");
  await expect(messageWith(bPage, "dos")).toBeVisible();
});

test("5. enlaces: sin EMBED_LINKS son texto; de un dominio no permitido llevan a /out con el aviso", async ({ context }) => {
  await openChannel(bPage, "General");
  await openChannel(modPage, "General");

  // B has no EMBED_LINKS: the URL stays plain text
  await composer(bPage).click();
  await composer(bPage).pressSequentially("fuera https://ejemplo-b.com/x ");
  await composer(bPage).press("Enter");
  await expect(messageWith(bPage, "ejemplo-b.com")).toBeVisible();
  await expect(messageWith(bPage, "ejemplo-b.com").getByRole("link")).toHaveCount(0);

  // the Moderador can embed links: the domain is not allowed, so the link goes through /out
  await composer(modPage).click();
  await composer(modPage).pressSequentially("mira https://ejemplo-mod.com/pagina?x=1 ");
  await composer(modPage).press("Enter");
  const link = messageWith(bPage, "ejemplo-mod.com").getByRole("link", { name: /ejemplo-mod.com/ });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toBe(`/out?u=${encodeURIComponent("https://ejemplo-mod.com/pagina?x=1")}`);
  expect(await link.getAttribute("rel")).toContain("noopener");

  const [popup] = await Promise.all([bCtx.waitForEvent("page"), link.click()]);
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveURL(/\/out\?u=/);
  await expect(popup.getByRole("heading", { name: "Vas a salir de El Club" })).toBeVisible();
  await expect(popup.getByText("ejemplo-mod.com", { exact: true })).toBeVisible();
  await expect(popup.getByText(/Nunca conectes tu wallet/)).toBeVisible();
  await popup.close();
  void context;
});

test("6. un canal sin VIEW no emite eventos al miembro: nada aparece en su vista ni en su barra", async () => {
  // B has General open; the admin posts in the hidden channel and then, as a sentinel, in General.
  await openChannel(bPage, "General");
  await adminPage.goto(`/c/${ids["Secreto"]}`);
  await expect(adminPage.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
  await send(adminPage, "contenido secreto");
  await expect(messageWith(adminPage, "contenido secreto")).toBeVisible();

  await adminPage.goto("/");
  await openChannel(adminPage, "General");
  await send(adminPage, "centinela general");
  // events are delivered in order: once the sentinel is here, a leaked secret event would be too
  await expect(messageWith(bPage, "centinela general")).toBeVisible();
  await expect(bPage.getByText("contenido secreto")).toHaveCount(0);
  await expect(channelsNav(bPage).getByRole("link", { name: /Secreto/ })).toHaveCount(0);

  // not readable by any other path either
  const response = await bPage.goto(`/c/${ids["Secreto"]}`);
  expect(response?.status()).toBe(404);
  await expect(bPage.getByText("contenido secreto")).toHaveCount(0);
  const leak = await service().from("messages").select("id").eq("channel_id", ids["Secreto"]);
  expect(leak.data).toHaveLength(1); // it exists, B just cannot see it
  await bPage.goto("/");
});

test("7. Alpha: /alpha abre el diálogo solo con alpha_enabled + EMBED_LINKS y valida la dirección", async () => {
  // Trading has alpha_enabled; B (no EMBED_LINKS) is not offered the command, the Moderador is.
  await openChannel(bPage, "Trading");
  await composer(bPage).click();
  await composer(bPage).pressSequentially("/alpha");
  await expect(bPage.getByRole("option", { name: /alpha/i })).toHaveCount(0);
  await composer(bPage).fill("");

  await openChannel(modPage, "Trading");
  await composer(modPage).click();
  await composer(modPage).fill("");
  await composer(modPage).pressSequentially("mi tesis /alpha");
  await modPage.getByRole("option", { name: /alpha/i }).click();
  const dialog = modPage.getByRole("dialog", { name: "Publicar alpha" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Tu tesis")).toHaveValue(/mi tesis/);

  await dialog.getByLabel("Contrato en Linea").fill("0x123");
  await dialog.getByRole("button", { name: "Publicar alpha" }).click();
  await expect(dialog.getByRole("alert")).toContainText("dirección de contrato válida");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
});

// Alpha end to end needs the real Linea RPC (getCode). Wrapped USDC-like token contract on Linea mainnet.
const LINEA_CONTRACT = "0x176211869cA2b568f2A7D4EE941E073a821EE1ff";
test("7b. Alpha de extremo a extremo con RPC de Linea real", async () => {
  test.skip(process.env.LINEA_RPC_REACHABLE !== "1", "needs network access to a Linea mainnet RPC: set LINEA_RPC_REACHABLE=1");
  await modPage.reload();
  await expect(modPage.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
  await composer(modPage).click();
  await composer(modPage).pressSequentially("tesis real /alpha");
  await modPage.getByRole("option", { name: /alpha/i }).click();
  const dialog = modPage.getByRole("dialog", { name: "Publicar alpha" });

  // an EOA-looking address: not a contract
  await dialog.getByLabel("Contrato en Linea").fill("0x000000000000000000000000000000000000dEaD");
  await dialog.getByRole("button", { name: "Publicar alpha" }).click();
  await expect(dialog.getByRole("alert")).toContainText("no es un contrato");

  await dialog.getByLabel("Contrato en Linea").fill(LINEA_CONTRACT);
  await dialog.getByRole("button", { name: "Publicar alpha" }).click();
  await expect(dialog).toHaveCount(0);
  const card = messageWith(modPage, "tesis real");
  await expect(card.getByText("Alpha · Tesis")).toBeVisible();
  await expect(card.getByRole("link", { name: /Lineascan/ })).toHaveAttribute(
    "href",
    `https://lineascan.build/address/${LINEA_CONTRACT.toLowerCase()}`,
  );
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator("iframe")).toHaveAttribute("src", /^https:\/\/dexscreener\.com\/linea\/0x/);
});

test("8. CSP: frame-ancestors none y frame-src acotado; el login renderiza sin errores", async ({ browser }) => {
  const anon = await browser.newContext();
  trackErrors(anon);
  const page = await anon.newPage();
  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("frame-src https://dexscreener.com");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await anon.close();
});

test("9. sin errores de consola", async () => {
  // Reown AppKit re-fetches the page URL to check its COOP header; on a deliberate 404 document it logs this line.
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  // The browser's own "Failed to load resource ... 404" line for the hidden channel B was sent to on purpose.
  const hidden404 = (e: string) => /status of 404/.test(e) && e.endsWith(`@ http://localhost:3000/c/${ids["Secreto"]}`);
  expect(browserErrors.filter((e) => !coopOn404(e) && !hidden404(e))).toEqual([]);
});

test("@screens capturas de F2b a 375 y 1440", async () => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to capture screenshots");
  const OUT = ".superpowers/sdd/f2b/screens";
  mkdirSync(OUT, { recursive: true });
  await openChannel(adminPage, "General");
  for (const width of [375, 1440] as const) {
    for (const p of [adminPage, bPage]) await p.setViewportSize({ width, height: 900 });
    await adminPage.goto(`/c/${ids["General"]}`);
    await expect(adminPage.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
    await adminPage.waitForLoadState("networkidle");
    await adminPage.screenshot({ path: `${OUT}/general-${width}.png`, fullPage: true });
    expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // thread panel (a panel at 1440, a full-screen dialog at 375)
    await messageWith(adminPage, "B corregido").getByRole("button", { name: /respuesta/ }).click();
    await expect(adminPage.getByText("respuesta de A").first()).toBeVisible();
    await adminPage.waitForTimeout(500);
    await adminPage.screenshot({ path: `${OUT}/thread-${width}.png` });
    await adminPage.keyboard.press("Escape");

    // expanded composer
    await composer(adminPage).click();
    await composer(adminPage).fill("# Título\n\nUn mensaje largo con **negrita** y una lista:\n- uno\n- dos");
    await adminPage.getByRole("button", { name: "Expandir editor" }).click();
    await expect(adminPage.getByRole("dialog", { name: "Editor ampliado" })).toBeVisible();
    await adminPage.waitForTimeout(500); // let the dialog's fade-in finish
    await adminPage.screenshot({ path: `${OUT}/expanded-${width}.png` });
    await adminPage.keyboard.press("Escape");

    // the link guard
    await adminPage.goto(`/out?u=${encodeURIComponent("https://ejemplo-mod.com/pagina?x=1")}`);
    await expect(adminPage.getByRole("heading", { name: "Vas a salir de El Club" })).toBeVisible();
    await adminPage.screenshot({ path: `${OUT}/out-${width}.png`, fullPage: true });
    expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
