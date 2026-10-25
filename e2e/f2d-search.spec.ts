import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CLUB_BASE, clubPath, addressOf, E2E_SUPER_ADMIN_ADDRESS, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { channelIds, createInvite, joinAs, openChannel, service, type Actor } from "./helpers/f2c";

// F2d acceptance: the Cmd+K palette (actions, channels, members, messages) and the jump to a message, with generated
// test wallets. The DB is reset by global-setup; scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

const keyA = newWalletKey();
const keyM = newWalletKey();
const keyN = newWalletKey();

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
let a: Actor; // plain member
let m: Actor; // plain member, searched by wallet
let n: Actor; // plain member who cannot post in Soporte Técnico
let ids: Record<string, string>;
let secretId = "";
let targetId = "";
let secretMsgId = "";
let rootId = "";
let replyId = "";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

type Seed = { channel_id: string; author_id: string; text: string; at: Date; thread_root_id?: string };
async function seed(rows: Seed[]): Promise<string[]> {
  const { data, error } = await service()
    .from("messages")
    .insert(
      rows.map((r) => ({
        channel_id: r.channel_id,
        author_id: r.author_id,
        body: doc(r.text),
        body_text: r.text,
        allow_links: false,
        created_at: r.at.toISOString(),
        thread_root_id: r.thread_root_id ?? null,
      })),
    )
    .select("id");
  expect(error).toBeNull();
  return (data ?? []).map((x: { id: string }) => x.id);
}

const palette = (p: Page) => p.getByRole("dialog", { name: "Buscar" });
const paletteInput = (p: Page) => palette(p).getByRole("combobox");
const results = (p: Page) => palette(p).getByRole("option");

/** Opens the palette with the keyboard shortcut and waits for its input to take the focus. */
async function openPalette(p: Page) {
  // Right after a navigation the shortcut listener may not be attached yet (hydration): press until it answers.
  // Once open, a further Ctrl+K is swallowed by the palette, so retrying is safe. Opening a dialog while the page body
  // is still hydrating makes Radix mutate the DOM under React (hydration mismatch), so let the network settle first.
  await p.waitForLoadState("networkidle");
  await expect(async () => {
    await p.keyboard.press("Control+K");
    await expect(palette(p)).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await expect(paletteInput(p)).toBeFocused();
}
const searchFor = async (p: Page, q: string) => {
  await openPalette(p);
  await paletteInput(p).fill(q);
};
const messageResult = (p: Page, text: string): Locator => results(p).filter({ hasText: text });
const li = (p: Page, id: string) => p.locator(`li[data-message-id="${id}"]`);

test.beforeAll(async ({ browser }) => {
  const adminCtx = await browser.newContext();
  trackErrors(adminCtx);
  await loginAs(adminCtx, E2E_SUPER_ADMIN_PK);
  const adminPage = await adminCtx.newPage();
  const db = service();
  const me = await db
    .from("members")
    .select("id")
    .eq("wallet_address", E2E_SUPER_ADMIN_ADDRESS.toLowerCase())
    .single<{ id: string }>();
  expect(me.error).toBeNull();
  admin = { context: adminCtx, page: adminPage, id: me.data!.id };
  a = await joinAs(browser, keyA, await createInvite(adminPage), "AnaBus", undefined, trackErrors);
  m = await joinAs(browser, keyM, await createInvite(adminPage), "MarcosBus", undefined, trackErrors);
  n = await joinAs(browser, keyN, await createInvite(adminPage), "NoraBus", undefined, trackErrors);
  ids = await channelIds();

  // N may see Soporte Técnico but not post in it.
  const deny = await db
    .from("permission_overwrites")
    .insert({ channel_id: ids["Soporte Técnico"], target_type: "member", target_id: n.id, allow: 0, deny: 2 });
  expect(deny.error).toBeNull();

  // A channel hidden from @everyone (VIEW denied) with a word that exists nowhere else.
  const everyone = await db.from("roles").select("id").eq("is_everyone", true).single<{ id: string }>();
  expect(everyone.error).toBeNull();
  const secret = await db
    .from("channels")
    .insert({ parent_id: ids["Comunidad"], kind: "text", name: "Secreta", position: 9 })
    .select("id")
    .single<{ id: string }>();
  expect(secret.error).toBeNull();
  secretId = secret.data!.id;
  const hide = await db
    .from("permission_overwrites")
    .insert({ channel_id: secretId, target_type: "role", target_id: everyone.data!.id, allow: 0, deny: 1 });
  expect(hide.error).toBeNull();
  secretMsgId = (await seed([{ channel_id: secretId, author_id: admin.id, text: "palabra xilofonoraro solo para el staff", at: new Date() }]))[0]!;

  // General: 100 old root messages. The target is the 21st oldest, so it lies outside the newest page (50) with
  // older messages beyond the +-15 window as well.
  const base = Date.now() - 3 * 24 * 3600 * 1000;
  const rows: Seed[] = Array.from({ length: 100 }, (_, i) => ({
    channel_id: ids["General"]!,
    author_id: a.id,
    text: i === 20 ? "Revisa la Línea de tiempo del proyecto antes del lanzamiento" : `relleno ${String(i).padStart(3, "0")}`,
    at: new Date(base + i * 60_000),
  }));
  const inserted = await seed(rows);
  targetId = inserted[20]!;

  // A thread: a recent root and a reply with a unique word.
  const [root] = await seed([
    { channel_id: ids["General"]!, author_id: admin.id, text: "hilo raíz zafiro", at: new Date(base + 200 * 60_000) },
  ]);
  rootId = root!;
  const [reply] = await seed([
    { channel_id: ids["General"]!, author_id: m.id, text: "respuesta con quetzal dentro del hilo", at: new Date(base + 201 * 60_000), thread_root_id: rootId },
  ]);
  replyId = reply!;
  const count = await db.from("messages").update({ reply_count: 1, last_reply_at: new Date(base + 201 * 60_000).toISOString() }).eq("id", rootId);
  expect(count.error).toBeNull();

  for (const p of [a.page, m.page, n.page]) await p.goto(clubPath());
});

test.afterAll(async () => {
  await admin?.context.close();
  for (const x of [a, m, n]) await x?.context.close();
});

test("1. A busca «linea» y encuentra «Línea»: Enter salta al mensaje fuera de la primera página, resaltado", async () => {
  await a.page.goto(clubPath());
  await searchFor(a.page, "linea");
  const hit = messageResult(a.page, "Línea de tiempo");
  await expect(hit).toBeVisible();
  await expect(results(a.page).filter({ hasText: "relleno" })).toHaveCount(0);
  await a.page.keyboard.press("Enter");

  await expect(a.page).toHaveURL(new RegExp(`${CLUB_BASE}/c/${ids["General"]}\\?(.*&)?m=${targetId}(&|$)`));
  await expect(palette(a.page)).toHaveCount(0);
  const target = li(a.page, targetId);
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(target).toBeInViewport();
  // the highlight is temporary
  await expect(target).not.toHaveAttribute("aria-current", "true", { timeout: 10_000 });
});

test("2. desde la vista anclada «Cargar anteriores» sigue funcionando y «Ir a lo más reciente» vuelve al final sin m", async () => {
  const page = a.page;
  await expect(li(page, targetId)).toBeVisible();
  // newest page is not loaded: the anchored window ends before the latest message
  await expect(page.getByText("relleno 099")).toHaveCount(0);
  await expect(page.getByText("relleno 000")).toHaveCount(0);

  await page.getByRole("button", { name: "Cargar anteriores" }).click();
  await expect(page.locator("li[data-message-id]", { hasText: "relleno 000" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Cargar anteriores" })).toHaveCount(0); // nothing older is left

  await page.getByRole("button", { name: "Ir a lo más reciente" }).click();
  await expect(page).not.toHaveURL(/[?&]m=/);
  await expect(page).toHaveURL(new RegExp(`${CLUB_BASE}/c/${ids["General"]}$`));
  await expect(page.locator("li[data-message-id]", { hasText: "hilo raíz zafiro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ir a lo más reciente" })).toHaveCount(0);
  await expect(page.locator("li[data-message-id]", { hasText: "relleno 000" })).toHaveCount(0);
});

test("3. una respuesta de hilo abre el hilo con la respuesta resaltada", async () => {
  await a.page.goto(clubPath());
  await searchFor(a.page, "quetzal");
  await expect(messageResult(a.page, "quetzal")).toBeVisible();
  await a.page.keyboard.press("Enter");
  await expect(a.page).toHaveURL(new RegExp(`${CLUB_BASE}/c/${ids["General"]}\\?thread=${rootId}&m=${replyId}`));
  const thread = a.page.getByRole("region", { name: "Hilo" });
  await expect(thread).toBeVisible();
  const reply = thread.locator(`li[data-message-id="${replyId}"]`);
  await expect(reply).toBeVisible();
  await expect(reply).toHaveAttribute("aria-current", "true");
  await expect(reply).toBeInViewport();
});

test("4. un miembro se encuentra por prefijo de wallet y lleva a su perfil", async () => {
  await a.page.goto(clubPath());
  const wallet = addressOf(keyM);
  await searchFor(a.page, wallet.slice(0, 10));
  const hit = results(a.page).filter({ hasText: "MarcosBus" });
  await expect(hit).toBeVisible();
  await a.page.keyboard.press("Enter");
  await expect(a.page).toHaveURL(new RegExp(`${CLUB_BASE}/u/${wallet}$`));
  await expect(a.page.getByRole("heading", { level: 1, name: /MarcosBus/ })).toBeVisible();
});

test("5. las acciones dependen del rol y «Abrir ticket» abre el diálogo", async () => {
  await a.page.goto(clubPath());
  await openPalette(a.page);
  await expect(results(a.page).filter({ hasText: "Mis tickets" })).toBeVisible();
  await expect(results(a.page).filter({ hasText: "Mi perfil" })).toBeVisible();
  await expect(results(a.page).filter({ hasText: "Ajustes del servidor" })).toHaveCount(0);
  await expect(results(a.page).filter({ hasText: "Cola de reportes" })).toHaveCount(0);
  await expect(results(a.page).filter({ hasText: "Crear invitación" })).toHaveCount(0);
  await a.page.keyboard.press("Escape");

  await admin.page.goto(clubPath());
  await openPalette(admin.page);
  for (const label of ["Ajustes del servidor", "Cola de reportes", "Crear invitación", "Miembros"]) {
    await expect(results(admin.page).filter({ hasText: label }).first()).toBeVisible();
  }
  await admin.page.keyboard.press("Escape");

  await openPalette(a.page);
  await paletteInput(a.page).fill("ticket");
  await results(a.page).filter({ hasText: "Abrir ticket en #Soporte Técnico" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Abrir un ticket" });
  await expect(dialog).toBeVisible();
  await expect(a.page).toHaveURL(new RegExp(`${CLUB_BASE}/c/${ids["Soporte Técnico"]}$`)); // ?openTicket is consumed
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
});

test("5b. ?openTicket=1 no abre nada sin tickets en el canal ni sin permiso de publicar", async () => {
  await a.page.goto(clubPath(`/c/${ids["General"]}?openTicket=1`));
  await expect(a.page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
  await a.page.waitForLoadState("networkidle");
  await expect(a.page.getByRole("dialog")).toHaveCount(0);
  await expect(a.page.getByRole("button", { name: "Abrir ticket" })).toHaveCount(0);

  // control: a member who can post does get the dialog from the same link
  await a.page.goto(clubPath(`/c/${ids["Soporte Técnico"]}?openTicket=1`));
  await expect(a.page.getByRole("dialog", { name: "Abrir un ticket" })).toBeVisible();

  await n.page.goto(clubPath(`/c/${ids["Soporte Técnico"]}?openTicket=1`));
  await expect(n.page.getByRole("heading", { level: 1, name: "Soporte Técnico" })).toBeVisible();
  await n.page.waitForLoadState("networkidle");
  await expect(n.page.getByRole("dialog")).toHaveCount(0);
  await expect(n.page.getByRole("button", { name: "Abrir ticket" })).toHaveCount(0);
  // and the palette does not offer the action to N either
  await searchFor(n.page, "ticket");
  await expect(results(n.page).filter({ hasText: "Mis tickets" })).toBeVisible();
  await expect(results(n.page).filter({ hasText: "Abrir ticket en #Soporte Técnico" })).toHaveCount(0);
  await expect(results(n.page).filter({ hasText: "Abrir ticket en #Ayuda" })).toBeVisible();
});

test("6. un mensaje de un canal oculto nunca llega a A; el admin sí lo encuentra", async () => {
  await a.page.goto(clubPath());
  await searchFor(a.page, "xilofonoraro");
  await expect(palette(a.page).getByText("Sin resultados para «xilofonoraro»")).toBeVisible();
  await expect(results(a.page)).toHaveCount(0);
  await a.page.keyboard.press("Escape");

  await admin.page.goto(clubPath());
  await searchFor(admin.page, "xilofonoraro");
  const hit = messageResult(admin.page, "xilofonoraro");
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("#Secreta");
  await admin.page.keyboard.press("Enter");
  await expect(admin.page).toHaveURL(new RegExp(`${CLUB_BASE}/c/${secretId}\\?.*m=${secretMsgId}`));
  const secretLi = li(admin.page, secretMsgId);
  await expect(secretLi).toBeVisible();
  await expect(secretLi).toHaveAttribute("aria-current", "true");

  // Anchor path: the hidden message id aimed at another channel reveals nothing and highlights nothing.
  await a.page.goto(clubPath(`/c/${ids["General"]}?m=${secretMsgId}`));
  await expect(a.page.getByRole("textbox", { name: "Mensaje", exact: true })).toBeVisible();
  await a.page.waitForLoadState("networkidle");
  await expect(a.page.locator('[aria-current="true"]')).toHaveCount(0);
  await expect(a.page.getByText("xilofonoraro")).toHaveCount(0);
});

test("7. solo con teclado: Ctrl+K, flechas, Enter y Escape devuelve el foco", async () => {
  await a.page.goto(clubPath());
  await openChannel(a.page, "General");
  const composer = a.page.getByRole("textbox", { name: "Mensaje", exact: true });
  await composer.click();
  await expect(composer).toBeFocused();

  await openPalette(a.page);
  const first = results(a.page).first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await a.page.keyboard.press("ArrowDown");
  await expect(results(a.page).nth(1)).toHaveAttribute("aria-selected", "true");
  await a.page.keyboard.press("ArrowUp");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await a.page.keyboard.press("Escape");
  await expect(palette(a.page)).toHaveCount(0);
  await expect(composer).toBeFocused();

  await openPalette(a.page);
  await a.page.keyboard.press("ArrowDown"); // Mis menciones -> Mis tickets
  await expect(results(a.page).nth(1)).toContainText("Mis tickets");
  await a.page.keyboard.press("Enter");
  await expect(a.page).toHaveURL(/\/foro\/tickets$/);
  await expect(palette(a.page)).toHaveCount(0);
});

test("8. a 375px: el botón de la barra superior y el del drawer abren la paleta sin scroll horizontal", async () => {
  const page = await a.context.newPage();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(clubPath(`/c/${ids["General"]}`));
  const noOverflow = () => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);

  const topButton = page.getByRole("banner").getByRole("button", { name: "Buscar" });
  await expect(topButton).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect((await topButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await topButton.click();
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  await paletteInput(page).fill("linea");
  await expect(messageResult(page, "Línea de tiempo")).toBeVisible();
  expect(await noOverflow()).toBe(true);
  const box = (await palette(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(topButton).toBeFocused();

  // from inside the drawer
  await page.getByRole("button", { name: "Abrir menú" }).click();
  const drawer = page.getByRole("dialog", { name: "Menú" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Buscar" }).click();
  await expect(palette(page)).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await expect(paletteInput(page)).toBeFocused();
  expect(await noOverflow()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeFocused();
  await page.close();
});

test("9. sin errores de consola", async () => {
  expect(browserErrors).toEqual([]);
});
