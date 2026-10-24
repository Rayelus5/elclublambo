import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_SUPER_ADMIN_ADDRESS, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { channelIds, createInvite, joinAs, rpcAs, service, type Actor } from "./helpers/f2c";

// P1 Task 13: the new Inicio. A plain member (A) uses the search field (the palette's engine in place), never sees a
// message of a channel hidden from them, can still open the palette with Ctrl+K from the field, and sees the quick
// tiles reflect an open poll and an open giveaway (created by the e2e SuperAdmin through the same RPCs the dialogs
// call) and «Continúa donde lo dejaste» list the channel with new messages. Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const STAMP = Date.now().toString(36);
const WORD = `colibri${STAMP}`;
const SECRET = `xilofono${STAMP}`;
const QUESTION = `¿Quedada el sábado ${STAMP}?`;
const GIVEAWAY = `Camisetas ${STAMP}`;

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
async function seed(channelId: string, authorId: string, text: string): Promise<string> {
  const { data, error } = await service()
    .from("messages")
    .insert({ channel_id: channelId, author_id: authorId, body: doc(text), body_text: text, allow_links: false })
    .select("id")
    .single<{ id: string }>();
  expect(error).toBeNull();
  return data!.id;
}

let admin: Actor;
let a: Actor;
let ids: Record<string, string>;
let wordId = "";
let pollId = "";
let giveawayId = "";

const SHOTS = ".superpowers/sdd/2026-10-24-p1-club-simplificado/screens";
async function shot(p: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  // The cards rise in when scrolled into view: bring them in once so the full-page capture shows them settled.
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(900);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const field = (p: Page) => p.getByRole("combobox", { name: "Buscar en ElClub." });
const panel = (p: Page) => p.locator("[data-home-search]").getByRole("listbox");
const tiles = (p: Page) => p.getByRole("list", { name: "Accesos rápidos" });

/** Opens Inicio and waits for hydration (a field filled before it would not reach React). */
async function openHome(p: Page) {
  await p.goto("/");
  await expect(p.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  await p.waitForLoadState("networkidle");
}

/** Types into the Inicio field until the panel answers (retrying covers a late hydration). */
async function searchHome(p: Page, q: string, until: (p: Page) => Promise<void>) {
  await expect(async () => {
    await field(p).fill("");
    await field(p).fill(q);
    await until(p);
  }).toPass({ timeout: 20_000 });
}

test.beforeAll(async ({ browser }) => {
  const adminCtx = await browser.newContext({ viewport: desktop });
  trackErrors(adminCtx);
  await loginAs(adminCtx, E2E_SUPER_ADMIN_PK);
  const adminPage = await adminCtx.newPage();
  const db = service();
  const me = await db.from("members").select("id").eq("wallet_address", E2E_SUPER_ADMIN_ADDRESS.toLowerCase()).single<{ id: string }>();
  expect(me.error).toBeNull();
  admin = { context: adminCtx, page: adminPage, id: me.data!.id };
  a = await joinAs(browser, newWalletKey(), await createInvite(adminPage), "Ana Ruiz", undefined, trackErrors);
  await a.page.setViewportSize(desktop);
  ids = await channelIds();

  // A channel hidden from @everyone (VIEW denied) holding a word that exists nowhere else.
  const everyone = await db.from("roles").select("id").eq("is_everyone", true).single<{ id: string }>();
  expect(everyone.error).toBeNull();
  const hidden = await db
    .from("channels")
    .insert({ parent_id: ids["Comunidad"], kind: "text", name: `oculto-${STAMP}`, position: 30 })
    .select("id")
    .single<{ id: string }>();
  expect(hidden.error).toBeNull();
  const deny = await db.from("permission_overwrites").insert({ channel_id: hidden.data!.id, target_type: "role", target_id: everyone.data!.id, allow: 0, deny: 1 });
  expect(deny.error).toBeNull();
  await seed(hidden.data!.id, admin.id, `solo el staff conoce ${SECRET}`);

  // New in General for A (after A joined): the searched message.
  wordId = await seed(ids["General"]!, admin.id, `El ${WORD} vuela bajo esta semana`);
});

test.afterAll(async () => {
  for (const x of [admin, a]) await x?.context.close();
});

test("1. the Inicio field finds a message and Enter jumps to it", async () => {
  const p = a.page;
  await openHome(p);
  const option = panel(p).getByRole("option").filter({ hasText: WORD });
  await searchHome(p, WORD, async () => {
    await expect(option).toBeVisible({ timeout: 5_000 });
  });
  // Only the message matches: it is the selected result, and Enter takes it, as in the palette.
  await expect(option).toHaveAttribute("aria-selected", "true");
  await field(p).press("Enter");
  await expect(p).toHaveURL(new RegExp(`/c/${ids["General"]}\\?m=${wordId}`));
  await expect(p.locator(`li[data-message-id="${wordId}"]`)).toBeVisible();
});

test("2. a message of a channel hidden from the member never shows up", async () => {
  const p = a.page;
  await openHome(p);
  await searchHome(p, SECRET, async (pp) => {
    await expect(panel(pp).getByText(`Sin resultados para «${SECRET}»`)).toBeVisible({ timeout: 5_000 });
  });
  await expect(panel(p).getByRole("option")).toHaveCount(0);
  // Esc empties and folds; the word is nowhere on the page.
  await field(p).press("Escape");
  await expect(field(p)).toHaveValue("");
  await expect(panel(p)).toHaveCount(0);
  await expect(p.getByText(SECRET)).toHaveCount(0);
});

test("3. Ctrl+K with the focus in the field opens the palette", async () => {
  const p = a.page;
  await openHome(p);
  await field(p).click();
  await expect(panel(p)).toBeVisible();
  const palette = p.getByRole("dialog", { name: "Buscar" });
  await expect(async () => {
    await field(p).focus();
    await p.keyboard.press("Control+K");
    await expect(palette).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await expect(palette.getByRole("combobox")).toBeFocused();
  await p.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("4. the tiles reflect an open poll and an open giveaway", async () => {
  const closes = new Date(Date.now() + 2 * 3600_000).toISOString();
  const poll = await rpcAs(admin.context, "create_poll", { p_channel: ids["General"], p_question: QUESTION, p_options: ["Sí", "No"], p_closes_at: closes });
  expect(poll.error).toBeNull();
  pollId = poll.data as string;
  // 11 minutes: the giveaway closing first is the one Inicio shows (create_giveaway wants 10 at least).
  const g = await rpcAs(admin.context, "create_giveaway", {
    p_title: GIVEAWAY,
    p_description: null,
    p_closes_at: new Date(Date.now() + 11 * 60_000).toISOString(),
    p_prizes: [{ kind: "custom", label: "Camiseta" }],
  });
  expect(g.error).toBeNull();
  const created = g.data as { id?: string } | string;
  giveawayId = typeof created === "string" ? created : created.id!;
  expect(giveawayId).toMatch(/^[0-9a-f-]{36}$/);

  const p = a.page;
  await openHome(p);
  const t = tiles(p);
  const giveaway = t.getByRole("link", { name: /Sorteo/ });
  await expect(giveaway).toContainText(GIVEAWAY);
  await expect(giveaway).toContainText("Cierra");
  await expect(giveaway).toHaveAttribute("href", `/sorteos/${giveawayId}`);
  const pollTile = t.getByRole("link", { name: /Encuesta/ });
  await expect(pollTile).toContainText(QUESTION);
  await expect(pollTile).toHaveAttribute("href", `/c/${ids["General"]}?m=${pollId}`);
  await expect(t.getByRole("link", { name: /Donaciones/ })).toHaveAttribute("href", "/donar");
});

test("5. «Continúa donde lo dejaste» shows the channel with new messages", async () => {
  // A new message in Soporte Técnico (A never opened it): it is the newest unread channel.
  await seed(ids["Soporte Técnico"]!, admin.id, `¿Alguien con la wallet bloqueada? ${STAMP}`);
  const p = a.page;
  await openHome(p);
  const section = p.getByRole("region", { name: "Continúa donde lo dejaste" });
  const card = section.getByRole("link").filter({ hasText: "#Soporte Técnico" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 nuevo");
  await expect(card).toContainText(`¿Alguien con la wallet bloqueada? ${STAMP}`);
  await expect(card).toHaveAttribute("href", `/c/${ids["Soporte Técnico"]}`);
  // Never the hidden channel.
  await expect(section.getByText(`oculto-${STAMP}`)).toHaveCount(0);
  // The unread tile points at the newest unread channel.
  const unread = tiles(p).getByRole("link", { name: /Sin leer/ });
  await expect(unread).not.toContainText("Al día");
  await expect(unread).toHaveAttribute("href", `/c/${ids["Soporte Técnico"]}`);
  for (const width of [1280, 1920]) {
    await p.setViewportSize({ width, height: 1000 });
    await shot(p, `home-${width}`);
  }
  await p.setViewportSize(desktop);
});

test("6. no horizontal scroll at 375 px, folded or unfolded", async () => {
  const p = a.page;
  await p.setViewportSize({ width: 375, height: 800 });
  await openHome(p);
  const overflow = () => p.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(p, "home-375");
  await field(p).click();
  await expect(panel(p)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(p, "home-375-search");
  for (const link of await tiles(p).getByRole("link").all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await p.setViewportSize(desktop);
});

test("7. no console errors along the way", () => {
  expect(browserErrors).toEqual([]);
});
