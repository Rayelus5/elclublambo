import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { CLUB_BASE, clubPath, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import {
  bell,
  createInvite,
  joinAs,
  messageWith,
  openChannel,
  rpcAs,
  send,
  service,
  type Actor,
} from "./helpers/f2c";

// F2c acceptance, support: message reports with the moderation queue and private tickets, with generated test
// wallets. The DB is reset by global-setup; scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

const SUBJECT = "No puedo conectar mi wallet";
const SUBJECT_2 = "Otra duda rápida";

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

let admin: Actor;
let b: Actor; // reporter and ticket author
let c: Actor; // author of the reported message; plain member (never staff)
let mod: Actor; // Moderador: MANAGE_MESSAGES
let staff: Actor; // Soporte: MANAGE_TICKETS in Soporte Técnico
let ticketId = "";

/** The page's own status for a navigation: real HTTP, not the rendered body. */
async function statusOf(actor: Actor, path: string): Promise<number> {
  const response = await actor.page.goto(path);
  return response?.status() ?? 0;
}

test.beforeAll(async ({ browser }) => {
  const adminCtx = await browser.newContext();
  trackErrors(adminCtx);
  await loginAs(adminCtx, E2E_SUPER_ADMIN_PK);
  const adminPage = await adminCtx.newPage();
  admin = { context: adminCtx, page: adminPage, id: "" };
  b = await joinAs(browser, newWalletKey(), await createInvite(adminPage), "BetoSup", undefined, trackErrors);
  c = await joinAs(browser, newWalletKey(), await createInvite(adminPage), "CarlaSup", undefined, trackErrors);
  mod = await joinAs(browser, newWalletKey(), await createInvite(adminPage), "ModSup", "Moderador", trackErrors);
  staff = await joinAs(browser, newWalletKey(), await createInvite(adminPage), "SofiaSup", "Soporte", trackErrors);
  for (const p of [b.page, c.page, mod.page, staff.page]) await p.goto(clubPath());
});

test.afterAll(async () => {
  await admin?.context.close();
  for (const x of [b, c, mod, staff]) await x?.context.close();
});

test("1. B reporta un mensaje de C: el moderador lo ve en la cola, lo borra y el reporte pasa a resuelto", async () => {
  await openChannel(c.page, "General");
  await openChannel(b.page, "General");
  await send(c.page, "mensaje dudoso de C");
  await expect(messageWith(b.page, "mensaje dudoso de C")).toBeVisible();

  await messageWith(b.page, "mensaje dudoso de C").getByRole("button", { name: "Acciones del mensaje" }).click();
  await b.page.getByRole("menuitem", { name: "Reportar" }).click();
  const dialog = b.page.getByRole("dialog", { name: "Reportar mensaje" });
  await dialog.getByRole("radio", { name: /Spam/ }).check();
  await dialog.getByLabel("Nota (opcional)").fill("enlace sospechoso");
  await dialog.getByRole("button", { name: "Enviar reporte" }).click();
  // the dialog is retitled once sent, so look it up by its new name
  const sent = b.page.getByRole("dialog", { name: "Reporte enviado" });
  await expect(sent).toBeVisible();
  await sent.getByRole("button", { name: "Listo" }).click();
  await expect(sent).toHaveCount(0);

  await mod.page.goto(clubPath("/moderation/reports"));
  const card = mod.page.getByRole("article").filter({ hasText: "mensaje dudoso de C" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "1 reporte" })).toBeVisible();
  await expect(card.getByText("Spam ×1")).toBeVisible();
  await expect(card.getByText("enlace sospechoso")).toBeVisible();

  await card.getByRole("button", { name: "Borrar mensaje" }).click();
  await mod.page.getByRole("alertdialog").getByRole("button", { name: "Borrar y resolver" }).click();
  await expect(mod.page.getByText("mensaje dudoso de C")).toHaveCount(0);

  // the message is gone for everyone, and the report is closed with its outcome kept
  await expect(b.page.getByText("mensaje dudoso de C")).toHaveCount(0);
  await mod.page.getByRole("link", { name: "Resueltos" }).click();
  const closed = mod.page.getByRole("article").filter({ hasText: "mensaje dudoso de C" });
  await expect(closed).toBeVisible();
  await expect(closed.getByText("Acción tomada")).toBeVisible();
  const open = await service().from("reports").select("id").eq("status", "open");
  expect(open.data).toHaveLength(0);
});

test("2. /moderation/reports devuelve un 404 real a un miembro normal", async () => {
  expect(await statusOf(b, clubPath("/moderation/reports"))).toBe(404);
  expect(await statusOf(c, clubPath("/moderation/reports?status=closed"))).toBe(404);
  // control: the moderator gets the page itself
  expect(await statusOf(mod, clubPath("/moderation/reports"))).toBe(200);
});

test("3. B abre un ticket en Soporte Técnico: el staff recibe el aviso y responde, y B lo ve sin recargar", async () => {
  await b.page.goto(clubPath());
  await openChannel(b.page, "Soporte Técnico");
  await openChannel(staff.page, "Soporte Técnico");
  await expect(bell(staff.page, 0)).toBeVisible();

  await b.page.getByRole("button", { name: "Abrir ticket" }).click();
  const dialog = b.page.getByRole("dialog", { name: "Abrir un ticket" });
  await dialog.getByLabel("Asunto").fill(SUBJECT);
  await dialog.getByLabel("Mensaje").fill("Al pulsar conectar no pasa nada.");
  await dialog.getByRole("button", { name: "Enviar ticket" }).click();
  await expect(b.page).toHaveURL(/\/foro\/tickets\/[0-9a-f-]{36}$/);
  ticketId = b.page.url().split("/tickets/")[1]!;
  await expect(b.page.getByRole("heading", { level: 1, name: SUBJECT })).toBeVisible();

  // the staff member is told without reloading, and the notice leads to the ticket
  await expect(bell(staff.page, 1)).toBeVisible();
  await bell(staff.page, 1).click();
  const item = staff.page.getByRole("list", { name: "Notificaciones" }).getByRole("link", { name: new RegExp(`Nuevo ticket: ${SUBJECT}`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(staff.page).toHaveURL(new RegExp(`${CLUB_BASE}/tickets/${ticketId}$`));
  await expect(staff.page.getByText("Al pulsar conectar no pasa nada.")).toBeVisible();

  const reply = staff.page.getByLabel("Escribe tu respuesta");
  await reply.fill("Hola, prueba a desbloquear tu wallet primero.");
  await reply.press("Enter");
  const ours = b.page.getByRole("list", { name: "Mensajes del ticket" }).getByRole("listitem").filter({ hasText: "desbloquear tu wallet" });
  await expect(ours).toBeVisible(); // no reload on B's side
  await expect(ours.getByText("Staff", { exact: true })).toBeVisible();
  // and B is notified of the reply
  await expect(bell(b.page, 1)).toBeVisible();
});

test("4. C (no staff) recibe un 404 real en el ticket de B, y también con un id inexistente o mal formado", async () => {
  expect(await statusOf(c, clubPath(`/tickets/${ticketId}`))).toBe(404);
  expect(await statusOf(mod, clubPath(`/tickets/${randomUUID()}`))).toBe(404);
  expect(await statusOf(c, clubPath("/tickets/no-es-un-uuid"))).toBe(404);
  expect(await statusOf(c, clubPath("/tickets/123"))).toBe(404);
  await expect(c.page.getByText(SUBJECT)).toHaveCount(0);
  // controls: the author and the staff member get the page
  expect(await statusOf(b, clubPath(`/tickets/${ticketId}`))).toBe(200);
  expect(await statusOf(staff, clubPath(`/tickets/${ticketId}`))).toBe(200);
  // and C never got a notice about it
  const leak = await service().from("notifications").select("id").eq("recipient_id", c.id).not("ticket_id", "is", null);
  expect(leak.data).toHaveLength(0);
});

test("5. el staff cierra el ticket: B ve el cierre, ya no puede escribir y el foco no se pierde", async () => {
  await staff.page.getByRole("button", { name: "Cerrar ticket" }).click();
  await staff.page.getByRole("alertdialog").getByRole("button", { name: "Sí, cerrar" }).click();
  const reopen = staff.page.getByRole("button", { name: "Reabrir ticket" });
  await expect(reopen).toBeVisible();
  await expect(reopen).toBeFocused(); // focus is not left on <body> after the Cerrar button disappears

  await expect(b.page.getByText("Ticket cerrado")).toBeVisible(); // live, no reload
  await expect(b.page.getByLabel("Escribe tu respuesta")).toHaveCount(0);
  await expect(b.page.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
  await expect(b.page.getByRole("button", { name: "Reabrir ticket" })).toHaveCount(0);

  // B cannot write by any path: the server refuses with ticket_closed and the ticket keeps its two messages
  const attempt = await rpcAs(b.context, "post_ticket_message", { p_ticket: ticketId, p_body: "¿sigue abierto?" });
  expect(attempt.error?.message).toContain("ticket_closed");
  const rows = await service().from("ticket_messages").select("id").eq("ticket_id", ticketId);
  expect(rows.data).toHaveLength(2);
});

test("6. el autor cierra su ticket: el foco pasa al aviso «Ticket cerrado», no al body", async () => {
  await openChannel(b.page, "Soporte Técnico");
  await b.page.getByRole("button", { name: "Abrir ticket" }).click();
  const dialog = b.page.getByRole("dialog", { name: "Abrir un ticket" });
  await dialog.getByLabel("Asunto").fill(SUBJECT_2);
  await dialog.getByLabel("Mensaje").fill("Se me resolvió sola.");
  await dialog.getByRole("button", { name: "Enviar ticket" }).click();
  await expect(b.page.getByRole("heading", { level: 1, name: SUBJECT_2 })).toBeVisible();

  await b.page.getByRole("button", { name: "Cerrar ticket" }).click();
  await b.page.getByRole("alertdialog").getByRole("button", { name: "Sí, cerrar" }).click();
  const banner = b.page.getByRole("status").filter({ hasText: "Ticket cerrado" });
  await expect(banner).toBeVisible();
  await expect(banner).toBeFocused();
  expect(await b.page.evaluate(() => document.activeElement === document.body)).toBe(false);
  // the author cannot reopen it
  await expect(b.page.getByRole("button", { name: "Reabrir ticket" })).toHaveCount(0);
});

test("7. sin errores de consola", async () => {
  // Reown AppKit re-fetches the page URL to check its COOP header; on a deliberate 404 document it logs this line.
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  // (each entry ends with the page it came from, to find the culprit of a real error)
  // The browser's own "Failed to load resource ... 404" line for the pages those members were sent to on purpose.
  const expected404 = (e: string) => /status of 404/.test(e) && new RegExp(`@ http://localhost:3000${CLUB_BASE}/(tickets|moderation)/`).test(e.split(" (page ")[0]!);
  expect(browserErrors.filter((e) => !coopOn404(e) && !expected404(e))).toEqual([]);
});

test("@screens capturas de /tickets/[id] y /moderation/reports a 375 y 1440", async () => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to capture screenshots");
  const OUT = ".superpowers/sdd/f2c/screens";
  mkdirSync(OUT, { recursive: true });

  // an open report with two reasons for the queue
  await c.page.goto(clubPath());
  await openChannel(c.page, "General");
  await send(c.page, "mensaje para la captura de reportes, con un texto algo más largo para ver cómo se parte en móvil");
  await openChannel(b.page, "General");
  await openChannel(staff.page, "General");
  for (const reporter of [b, staff]) {
    await messageWith(reporter.page, "captura de reportes").getByRole("button", { name: "Acciones del mensaje" }).click();
    await reporter.page.getByRole("menuitem", { name: "Reportar" }).click();
    const dialog = reporter.page.getByRole("dialog", { name: "Reportar mensaje" });
    await dialog.getByRole("radio", { name: reporter === b ? /Spam/ : /Estafa/ }).check();
    await dialog.getByRole("button", { name: "Enviar reporte" }).click();
    await reporter.page.getByRole("dialog", { name: "Reporte enviado" }).getByRole("button", { name: "Listo" }).click();
  }

  for (const width of [375, 1440] as const) {
    for (const [name, actor, path] of [
      ["ticket", b, clubPath(`/tickets/${ticketId}`)],
      ["ticket-staff", staff, clubPath(`/tickets/${ticketId}`)],
      ["reports", mod, clubPath("/moderation/reports")],
    ] as const) {
      await actor.page.setViewportSize({ width, height: 900 });
      await actor.page.goto(path);
      await expect(actor.page.getByRole("heading", { level: 1 })).toBeVisible();
      if (name === "reports") await expect(actor.page.getByRole("article").first()).toBeVisible();
      await actor.page.waitForLoadState("networkidle");
      await actor.page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      expect(await actor.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflows at ${width}px`).toBe(true);
    }
  }
});
