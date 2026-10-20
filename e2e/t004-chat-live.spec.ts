import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";

// T-004 (ronda 1): the chat feels alive. Two members in two browsers: entry animation only for what arrives (never the
// history), day separators, the «N mensajes nuevos» pill when scrolled up, the deep-link highlight, the optimistic send
// with an idempotent retry, reduced motion and the widths. The DB is reset by global-setup; scenarios run serially.
test.describe.configure({ mode: "serial" });

const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
// Tests 4 and 5 break the send request on purpose: the browser logs that failed request, nothing else may fail.
let simulatingNetworkFailure = false;

/** Records every message row the page inserts: its text, whether it carried the entry class, and the computed duration. */
const RECORDER = `
  window.__rows = [];
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      const lis = n.matches('li[data-message-id]') ? [n] : Array.from(n.querySelectorAll('li[data-message-id]'));
      for (const li of lis) window.__rows.push({
        text: li.textContent || '',
        animated: li.classList.contains('animate-message-in'),
        duration: getComputedStyle(li).animationDuration,
      });
    }
  }).observe(document, { childList: true, subtree: true });
`;
type Row = { text: string; animated: boolean; duration: string };
const rows = (page: Page) => page.evaluate(() => (window as unknown as { __rows: Row[] }).__rows);

async function actor(browser: Browser, pk: `0x${string}`, invite?: string) {
  const context = await browser.newContext({ timezoneId: "Europe/Madrid" });
  context.on("console", (m) => {
    if (simulatingNetworkFailure && m.text().startsWith("Failed to load resource")) return;
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url}`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
  await context.addInitScript(RECORDER);
  await loginAs(context, pk, { invite });
  const page = await context.newPage();
  return { context, page };
}

const service = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const log = (page: Page) => page.getByRole("log", { name: "Mensajes del canal" });
const messageWith = (page: Page, text: string): Locator => page.locator("li[data-message-id]", { hasText: text });
const send = async (page: Page, text: string) => {
  const box = page.getByRole("textbox", { name: "Mensaje", exact: true });
  await box.click();
  await box.fill(text);
  await box.press("Enter");
};
/**
 * Right after a page load the viewer's private realtime topic may not have joined yet, and a message sent in that gap
 * only shows on the next resync. Send numbered tries until one arrives live; returns the text that did.
 */
async function sendUntilLive(from: Page, to: Page, text: string): Promise<string> {
  for (let i = 1; i <= 4; i++) {
    const t = `${text} ${i}`;
    await send(from, t);
    if (await messageWith(to, t).waitFor({ timeout: 4000 }).then(() => true, () => false)) return t;
  }
  throw new Error(`«${text}» never arrived live`);
}
/** The composer's editor only exists on the client: once it is there the list is hydrated (its scroll handler too). */
const hydrated = (page: Page) => expect(page.getByRole("textbox", { name: "Mensaje", exact: true })).toBeVisible();
const distanceFromBottom = (page: Page) => log(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
const countInDb = async (text: string) => {
  const { count } = await service().from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channelId).eq("body_text", text);
  return count ?? 0;
};

let admin: BrowserContext;
let adminPage: Page;
let member: BrowserContext;
let memberPage: Page;
let channelId = "";
let targetId = "";

test.beforeAll(async ({ browser }) => {
  ({ context: admin, page: adminPage } = await actor(browser, E2E_SUPER_ADMIN_PK));
  await adminPage.goto("/invites");
  await adminPage.getByRole("button", { name: "Crear invitación" }).click();
  const url = await adminPage.getByLabel("Tu enlace de invitación").inputValue();
  const memberKey = newWalletKey();
  ({ context: member, page: memberPage } = await actor(browser, memberKey, url.split("/invite/")[1]!));

  // A channel of its own with enough history to scroll: 10 messages from yesterday (one is the deep-link target),
  // then 25 from the last hour.
  const db = service();
  const parent = await db.from("channels").select("id").eq("name", "Comunidad").single<{ id: string }>();
  const created = await db
    .from("channels")
    .insert({ parent_id: parent.data!.id, kind: "text", name: "Vivo", position: 30 })
    .select("id")
    .single<{ id: string }>();
  expect(created.error).toBeNull();
  channelId = created.data!.id;
  const author = await db.from("members").select("id").eq("wallet_address", addressOf(memberKey)).single<{ id: string }>();
  expect(author.error).toBeNull();
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const seed = [
    ...Array.from({ length: 10 }, (_, i) => ({ text: i === 4 ? "objetivo del enlace" : `ayer ${i}`, created_at: at(24 * 3600_000 - i * 60_000) })),
    ...Array.from({ length: 25 }, (_, i) => ({ text: `historia ${i}`, created_at: at(3600_000 - i * 2 * 60_000) })),
  ];
  const ins = await db
    .from("messages")
    .insert(seed.map((s) => ({ channel_id: channelId, author_id: author.data!.id, body: doc(s.text), body_text: s.text, allow_links: true, created_at: s.created_at })))
    .select("id, body_text");
  expect(ins.error).toBeNull();
  targetId = (ins.data as Array<{ id: string; body_text: string }>).find((r) => r.body_text === "objetivo del enlace")!.id;

  await adminPage.goto(`/c/${channelId}`);
  await memberPage.goto(`/c/${channelId}`);
  await expect(messageWith(adminPage, "historia 24")).toBeVisible();
  await expect(messageWith(memberPage, "historia 24")).toBeVisible();
});

test.afterAll(async () => {
  await admin?.close();
  await member?.close();
});

test("1. el historial no se anima al abrir; un mensaje que llega entra con animación", async () => {
  const opened = await rows(adminPage);
  expect(opened.length).toBeGreaterThanOrEqual(35);
  expect(opened.filter((r) => r.animated)).toEqual([]);

  // Days in the viewer's time zone.
  await expect(adminPage.getByRole("separator", { name: "Ayer" })).toHaveCount(1);
  await expect(adminPage.getByRole("separator", { name: "Hoy" })).toHaveCount(1);

  await send(memberPage, "llega en vivo");
  await expect(messageWith(adminPage, "llega en vivo")).toBeVisible();
  const live = (await rows(adminPage)).filter((r) => r.text.includes("llega en vivo"));
  expect(live).toHaveLength(1);
  expect(live[0]).toMatchObject({ animated: true, duration: "0.2s" });
  // At the bottom, the reader follows the new message: no pill.
  await expect.poll(() => distanceFromBottom(adminPage)).toBeLessThan(48);
  await expect(adminPage.getByRole("button", { name: /mensajes? nuevos?/ })).toHaveCount(0);
});

test("2. leyendo más arriba no me mueve: sale la pastilla «N mensajes nuevos» y me lleva abajo", async () => {
  await log(adminPage).evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => distanceFromBottom(adminPage)).toBeGreaterThan(200);
  await send(memberPage, "nuevo uno");
  await expect(messageWith(memberPage, "nuevo uno")).toBeVisible();
  await send(memberPage, "nuevo dos");
  const pill = adminPage.getByRole("button", { name: "2 mensajes nuevos" });
  await expect(pill).toBeVisible();
  expect(await log(adminPage).evaluate((el) => el.scrollTop)).toBeLessThan(50);
  await pill.click();
  await expect.poll(() => distanceFromBottom(adminPage)).toBeLessThan(48);
  await expect(pill).toHaveCount(0);
  await expect(messageWith(adminPage, "nuevo dos")).toBeInViewport();
});

test("3. un enlace a un mensaje lo centra y lo resalta un momento", async () => {
  await adminPage.goto(`/c/${channelId}?m=${targetId}`);
  const target = messageWith(adminPage, "objetivo del enlace");
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(target).toBeInViewport();
  await expect(target.locator("> span[aria-hidden]").first()).toHaveCSS("opacity", "1");
  // The highlight is brief.
  await expect(target).not.toHaveAttribute("aria-current", "true", { timeout: 5000 });
  await expect(target.locator("> span[aria-hidden]").first()).toHaveCSS("opacity", "0");
  // A jump into history animates nothing either.
  expect((await rows(adminPage)).filter((r) => r.animated && !r.text.includes("llega en vivo"))).toEqual([]);
});

test("4. si se pierde la respuesta del envío, el mensaje no se duplica", async () => {
  await adminPage.goto(`/c/${channelId}`);
  await expect(messageWith(adminPage, "nuevo dos")).toBeVisible();
  const text = "se pierde la respuesta";
  // The server action runs (the message is written) but its answer never reaches the browser.
  let lost = 0;
  simulatingNetworkFailure = true;
  await adminPage.route(`**/c/${channelId}`, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes(text)) {
      lost += 1;
      await route.fetch();
      await route.fulfill({ status: 500, body: "" });
    } else await route.fallback();
  });
  await send(adminPage, text);
  await expect.poll(() => countInDb(text)).toBe(1);
  expect(lost).toBe(1);
  // Either realtime already adopted it by its key, or the retry resends the same key and the server returns it.
  const retry = messageWith(adminPage, text).getByRole("button", { name: "Reintentar" });
  if (await retry.isVisible().catch(() => false)) await retry.click();
  await expect(messageWith(adminPage, text)).toHaveCount(1);
  await expect(messageWith(adminPage, text)).not.toContainText("No se ha enviado");
  await expect(messageWith(adminPage, text)).not.toContainText("Enviando…");
  await expect(messageWith(memberPage, text)).toHaveCount(1);
  expect(await countInDb(text)).toBe(1);
  await adminPage.unrouteAll({ behavior: "ignoreErrors" });
  simulatingNetworkFailure = false;
});

test("5. si el envío no llega al servidor, se marca en rojo y «Reintentar» lo envía una sola vez", async () => {
  const text = "sin conexion al enviar";
  let aborted = 0;
  simulatingNetworkFailure = true;
  await adminPage.route(`**/c/${channelId}`, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes(text)) {
      aborted += 1;
      await route.abort();
    } else await route.fallback();
  });
  await send(adminPage, text);
  const row = messageWith(adminPage, text);
  await expect(row).toContainText("No se ha enviado.");
  // The send failed: the composer is free and empty, the text lives in the failed row.
  await expect(adminPage.getByRole("textbox", { name: "Mensaje", exact: true })).toHaveText("");
  expect(aborted).toBe(1);
  expect(await countInDb(text)).toBe(0);
  await adminPage.unrouteAll({ behavior: "ignoreErrors" });
  simulatingNetworkFailure = false;

  await row.getByRole("button", { name: "Reintentar" }).click();
  await expect(row).not.toContainText("No se ha enviado.");
  await expect(messageWith(memberPage, text)).toBeVisible();
  await expect.poll(() => countInDb(text)).toBe(1);
  await expect(messageWith(adminPage, text)).toHaveCount(1);
  await expect(messageWith(memberPage, text)).toHaveCount(1);
});

test("5b. el mismo texto enviado desde otra pestaña no se adopta: el fallido sigue fallido y al reintentar hay dos", async () => {
  const text = "mismo texto en dos pestanas";
  simulatingNetworkFailure = true;
  await adminPage.route(`**/c/${channelId}`, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes(text)) await route.abort();
    else await route.fallback();
  });
  await send(adminPage, text);
  const failed = messageWith(adminPage, text).filter({ hasText: "No se ha enviado." });
  await expect(failed).toHaveCount(1);
  await adminPage.unrouteAll({ behavior: "ignoreErrors" });
  simulatingNetworkFailure = false;

  // The same member writes the same words from another tab.
  const otherTab = await admin.newPage();
  await otherTab.goto(`/c/${channelId}`);
  await hydrated(otherTab);
  await send(otherTab, text);
  await expect.poll(() => countInDb(text)).toBe(1);
  // The first tab shows that message AND keeps its own failed row: nothing is adopted by text.
  await expect(messageWith(adminPage, text)).toHaveCount(2);
  await expect(failed).toHaveCount(1);
  await otherTab.close();

  await failed.getByRole("button", { name: "Reintentar" }).click();
  await expect(failed).toHaveCount(0);
  await expect.poll(() => countInDb(text)).toBe(2);
  await expect(messageWith(adminPage, text)).toHaveCount(2);
  await expect(messageWith(memberPage, text)).toHaveCount(2);
});

test("6. con «reducir movimiento» no hay animación de entrada", async () => {
  await adminPage.emulateMedia({ reducedMotion: "reduce" });
  await adminPage.goto(`/c/${channelId}`);
  await hydrated(adminPage);
  const arrived = await sendUntilLive(memberPage, adminPage, "llega sin movimiento");
  const live = (await rows(adminPage)).filter((r) => r.text.includes(arrived));
  expect(live).toHaveLength(1);
  // The global reduced-motion rule cuts it to 0.01 ms: the message just appears.
  expect(Number.parseFloat(live[0]!.duration)).toBeLessThan(0.001);
  await adminPage.emulateMedia({ reducedMotion: "no-preference" });
});

for (const width of [375, 768, 1024, 1440]) {
  test(`7. a ${width}px: sin scroll horizontal, separadores y pastilla dentro de la pantalla`, async () => {
    await adminPage.setViewportSize({ width, height: 860 });
    await adminPage.goto(`/c/${channelId}`);
    await hydrated(adminPage);
    // Scroll up once the list is hydrated (a scroll before hydration is undone by the initial bottom placement).
    await expect
      .poll(async () => {
        await log(adminPage).evaluate((el) => (el.scrollTop = 0));
        return distanceFromBottom(adminPage);
      })
      .toBeGreaterThan(200);
    const arrived = await sendUntilLive(memberPage, adminPage, `ancho ${width}`);
    const pill = adminPage.getByRole("button", { name: /^\d+ mensajes? nuevos?$/ });
    await expect(pill).toBeVisible();
    await expect(pill).toBeInViewport({ ratio: 1 });
    const box = await pill.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await adminPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await adminPage.screenshot({ path: `test-results/t004-${width}-pill.png` });
    await pill.click();
    await expect(messageWith(adminPage, arrived)).toBeInViewport();
    await adminPage.screenshot({ path: `test-results/t004-${width}-bottom.png` });
  });
}

test("8. sin errores de consola (ni de hidratación)", async () => {
  expect(browserErrors).toEqual([]);
});
