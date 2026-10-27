import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clubPath, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";

// Realtime chat view (F2b Task 9): live delivery, reactions, threads, soft delete and unread dots, with two
// members in two browser contexts. The DB is reset by global-setup; scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

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
  await loginAs(context, pk, { invite });
  const page = await context.newPage();
  return { context, page };
}

let admin: BrowserContext;
let adminPage: Page;
let member: BrowserContext;
let memberPage: Page;

const channelsNav = (page: Page) => page.getByRole("navigation", { name: "Canales" });
const openChannel = async (page: Page, name: string) => {
  // The link's name gains " sin leer" when the channel has unread messages.
  await channelsNav(page).getByRole("link", { name: new RegExp(`^${name}( sin leer)?$`) }).click();
  // the previous channel's log stays mounted until the navigation lands: wait for the new heading first
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
};
const send = async (page: Page, text: string) => {
  const box = page.getByRole("textbox", { name: "Mensaje", exact: true });
  await box.click();
  await box.fill(text);
  await box.press("Enter");
};
const messageWith = (page: Page, text: string) => page.locator("li[data-message-id]", { hasText: text }).first();

test.beforeAll(async ({ browser }) => {
  ({ context: admin, page: adminPage } = await actor(browser, E2E_SUPER_ADMIN_PK));
  await adminPage.goto(clubPath("/invites"));
  await adminPage.getByRole("button", { name: "Crear invitación" }).click();
  const url = await adminPage.getByLabel("Tu enlace de invitación").inputValue();
  ({ context: member, page: memberPage } = await actor(browser, newWalletKey(), url.split("/invite/")[1]!));
  await adminPage.goto(clubPath());
  await memberPage.goto(clubPath());
  await openChannel(adminPage, "General");
  await openChannel(memberPage, "General");
});

test.afterAll(async () => {
  await admin?.close();
  await member?.close();
});

test("1. un mensaje llega en vivo al otro miembro", async () => {
  await send(adminPage, "hola desde el admin");
  await expect(messageWith(adminPage, "hola desde el admin")).toBeVisible();
  await expect(messageWith(memberPage, "hola desde el admin")).toBeVisible();
});

test("2. una reacción se ve en vivo y alterna con aria-pressed", async () => {
  const mine = messageWith(memberPage, "hola desde el admin");
  // Discord-style: no add button under a message without reactions; it lives in the actions menu.
  await expect(mine.getByRole("button", { name: "Añadir reacción" })).toHaveCount(0);
  await mine.hover();
  await mine.getByRole("button", { name: "Acciones del mensaje" }).click();
  await memberPage.getByRole("menuitem", { name: "Añadir reacción" }).click();
  await memberPage.getByRole("button", { name: "Insertar 😀" }).click();
  const chipMember = mine.getByRole("button", { name: /😀/ });
  await expect(chipMember).toHaveAttribute("aria-pressed", "true");

  const chipAdmin = messageWith(adminPage, "hola desde el admin").getByRole("button", { name: /😀/ });
  await expect(chipAdmin).toHaveAttribute("aria-pressed", "false");
  await expect(chipAdmin).toContainText("1");

  await chipMember.click();
  await expect(chipAdmin).toHaveCount(0);
});

test("3. un hilo: la respuesta llega en vivo y el contador se actualiza", async () => {
  await messageWith(adminPage, "hola desde el admin").getByRole("button", { name: "Acciones del mensaje" }).click();
  await adminPage.getByRole("menuitem", { name: "Responder en hilo" }).click();
  const panel = adminPage.getByRole("complementary", { name: "Panel del hilo" });
  await expect(panel.getByRole("heading", { name: "Hilo" })).toBeFocused();
  const box = panel.getByRole("textbox", { name: "Mensaje", exact: true });
  await box.click();
  await box.fill("primera respuesta");
  await box.press("Enter");
  await expect(panel.getByText("primera respuesta")).toBeVisible();

  await expect(messageWith(memberPage, "hola desde el admin").getByRole("button", { name: "1 respuesta" })).toBeVisible();
  // replies never appear in the timeline
  await expect(memberPage.getByRole("log", { name: "Mensajes del canal" }).getByText("primera respuesta")).toHaveCount(0);

  await panel.getByRole("button", { name: "Cerrar hilo" }).click();
  await expect(panel).toHaveCount(0);
});

test("4. el canal con mensajes nuevos aparece sin leer y se limpia al abrirlo", async () => {
  await openChannel(memberPage, "Trading");
  await send(adminPage, "mensaje mientras estabas fuera");
  await expect(messageWith(adminPage, "mensaje mientras estabas fuera")).toBeVisible();
  // navigating re-checks the unread channels
  await memberPage.goto(clubPath());
  await expect(channelsNav(memberPage).getByRole("link", { name: /General/ }).getByLabel("sin leer")).toBeVisible();
  await openChannel(memberPage, "General");
  await expect(memberPage.getByRole("separator", { name: "Nuevos mensajes" })).toBeVisible();
  await expect(messageWith(memberPage, "mensaje mientras estabas fuera")).toBeVisible();
  await memberPage.goto(clubPath());
  await expect(channelsNav(memberPage).getByRole("link", { name: /General/ }).getByLabel("sin leer")).toHaveCount(0);
});

test("5. borrar un mensaje con hilo deja el marcador y el otro miembro lo ve", async () => {
  await openChannel(memberPage, "General");
  await messageWith(adminPage, "hola desde el admin").getByRole("button", { name: "Acciones del mensaje" }).click();
  await adminPage.getByRole("menuitem", { name: "Borrar" }).click();
  await adminPage.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(messageWith(adminPage, "Mensaje eliminado")).toBeVisible();
  await expect(messageWith(memberPage, "Mensaje eliminado")).toBeVisible();
  await expect(memberPage.getByText("hola desde el admin")).toHaveCount(0);
  // the thread survives
  await expect(messageWith(memberPage, "Mensaje eliminado").getByRole("button", { name: "1 respuesta" })).toBeVisible();
});

test("6. móvil (375px): sin scroll horizontal y el hilo se abre como diálogo con foco gestionado", async () => {
  await memberPage.setViewportSize({ width: 375, height: 700 });
  await expect(memberPage.getByRole("log", { name: "Mensajes del canal" })).toBeVisible();
  expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const opener = messageWith(memberPage, "Mensaje eliminado").getByRole("button", { name: "1 respuesta" });
  await opener.click();
  const dialog = memberPage.getByRole("dialog", { name: "Hilo" });
  await expect(dialog.getByText("primera respuesta")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Hilo" })).toBeFocused();
  await memberPage.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("7. sin errores de consola", async () => {
  expect(browserErrors).toEqual([]);
});
