import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import {
  bell,
  channelIds,
  createInvite,
  joinAs,
  messageWith,
  openChannel,
  send,
  sendMention,
  service,
  type Actor,
} from "./helpers/f2c";

// F2c acceptance, notifications: the bell, follow levels and Web Push opt-in, with generated test wallets.
// The DB is reset by global-setup; scenarios share state, so run serially.
test.describe.configure({ mode: "serial" });

const keyA = newWalletKey();
const keyB = newWalletKey();
const NAME_A = "AnaNotif";
const NAME_B = "BetoNotif";

const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error") browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

let admin: Actor;
let a: Actor;
let b: Actor;
let ids: Record<string, string>;

const kindsFor = async (memberId: string) => {
  const { data, error } = await service().from("notifications").select("kind, channel_id").eq("recipient_id", memberId);
  expect(error).toBeNull();
  return (data ?? []) as Array<{ kind: string; channel_id: string | null }>;
};

test.beforeAll(async ({ browser }) => {
  const adminCtx = await browser.newContext();
  trackErrors(adminCtx);
  await loginAs(adminCtx, E2E_SUPER_ADMIN_PK);
  const adminPage = await adminCtx.newPage();
  admin = { context: adminCtx, page: adminPage, id: "" };
  a = await joinAs(browser, keyA, await createInvite(adminPage), NAME_A, undefined, trackErrors);
  b = await joinAs(browser, keyB, await createInvite(adminPage), NAME_B, undefined, trackErrors);
  ids = await channelIds();
  expect(addressOf(keyA)).not.toBe(addressOf(keyB));
  for (const p of [a.page, b.page]) await p.goto("/");
});

test.afterAll(async () => {
  await admin?.context.close();
  await a?.context.close();
  await b?.context.close();
});

test("1. B menciona a A: la campana de A sube sin recargar, el ítem lleva al canal y al abrirlo baja", async () => {
  await openChannel(a.page, "General");
  await openChannel(b.page, "General");
  await expect(bell(a.page, 0)).toBeVisible();

  await sendMention(b.page, NAME_A, " échale un ojo a esto");
  await expect(messageWith(b.page, "échale un ojo")).toBeVisible();
  // no navigation, no reload: the counter arrives through the member realtime topic
  await expect(bell(a.page, 1)).toBeVisible();

  await bell(a.page, 1).click();
  await expect(a.page).toHaveURL(/\/notifications$/);
  const item = a.page.getByRole("list", { name: "Notificaciones" }).getByRole("link", { name: new RegExp(`${NAME_B}.*te mencionó en #General`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(a.page).toHaveURL(new RegExp(`/c/${ids["General"]}`));
  await expect(a.page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
  await expect(bell(a.page, 0)).toBeVisible();
  await expect.poll(async () => (await service().from("notifications").select("id").eq("recipient_id", a.id).is("read_at", null)).data?.length).toBe(0);
});

test("2. Todos los mensajes avisa; con Silencio un mensaje raíz y un @everyone del admin no avisan, la mención directa sí", async () => {
  await admin.page.goto("/");
  await openChannel(a.page, "Trading");
  await openChannel(b.page, "Trading");
  await openChannel(admin.page, "Trading");
  const followButton = a.page.getByRole("button", { name: /^Avisos del canal:/ });
  const inTrading = async () => (await kindsFor(a.id)).filter((n) => n.channel_id === ids["Trading"]).map((n) => n.kind).sort();

  // Trading defaults to "solo menciones", so only after choosing "Todos" can a root message notify
  await followButton.click();
  await a.page.getByRole("menuitemradio", { name: "Todos los mensajes" }).click();
  await expect(a.page.getByRole("button", { name: "Avisos del canal: todos los mensajes" })).toBeVisible();
  const level = async () =>
    (await service().from("channel_follow_prefs").select("level").eq("member_id", a.id).eq("channel_id", ids["Trading"]!)).data;
  await expect.poll(level).toEqual([{ level: "all" }]); // the menu is optimistic: wait for the server
  await send(b.page, "raíz con A en todo");
  await expect(messageWith(a.page, "raíz con A en todo")).toBeVisible();
  await expect(bell(a.page, 1)).toBeVisible();
  expect(await inTrading()).toEqual(["channel_message"]);

  // Mute: neither a root message nor an @everyone from the admin (who has MENTION_EVERYONE) reaches A
  await followButton.click();
  await a.page.getByRole("menuitemradio", { name: "Silenciar" }).click();
  await expect(a.page.getByRole("button", { name: "Avisos del canal: silenciado" })).toBeVisible();
  // the menu updates optimistically: wait until the server has stored the preference before sending anything
  await expect.poll(level).toEqual([{ level: "mute" }]);

  await send(b.page, "raíz con A en silencio");
  await expect(messageWith(b.page, "raíz con A en silencio")).toBeVisible();
  await sendMention(admin.page, "everyone", " aviso general");
  await expect(messageWith(b.page, "aviso general")).toBeVisible(); // it did reach the channel (and B)
  // a direct @member mention is not suppressed by mute and doubles as the "nothing else arrived" sentinel
  await sendMention(b.page, NAME_A, " ping directo");
  await expect(messageWith(a.page, "ping directo")).toBeVisible();
  await expect(bell(a.page, 2)).toBeVisible();
  expect(await inTrading()).toEqual(["channel_message", "mention"]);
  // control: the @everyone really notified someone who is not muted
  const everyoneForB = await service().from("notifications").select("kind").eq("recipient_id", b.id).eq("channel_id", ids["Trading"]!);
  expect(everyoneForB.data?.map((n) => (n as { kind: string }).kind)).toContain("mention");
});

// Always-on variant of the push opt-in. Only the browser's push-service handshake is stubbed (permission and
// PushManager.subscribe/getSubscription, which need Google API keys that Playwright's Chromium lacks); everything
// else is the real path: the toggle, the service worker registration, the server action, the anti-SSRF validation
// of the endpoint and p256dh/auth shapes in save_push_subscription, RLS and delete.
test("3a. Web Push (suscripción simulada): el interruptor crea la fila, B no tiene ninguna y al apagarlo se borra", async ({ browser }) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(12).toString("hex")}`;
  const p256dh = randomBytes(65).toString("base64url"); // 87 chars, like a real uncompressed P-256 key
  const auth = randomBytes(16).toString("base64url"); // 22 chars
  const context = await browser.newContext();
  trackErrors(context);
  await loginAs(context, keyA);
  await context.addInitScript(
    ({ endpoint, p256dh, auth }) => {
      Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true });
      Notification.requestPermission = async () => "granted";
      let current: unknown = null;
      const fake = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      };
      PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
      PushManager.prototype.subscribe = async () => {
        current = fake;
        return fake as unknown as PushSubscription;
      };
    },
    { endpoint, p256dh, auth },
  );
  try {
    const page = await context.newPage();
    await page.goto("/notifications");
    const on = page.getByRole("button", { name: "Desactivar avisos en este dispositivo" });
    const off = page.getByRole("button", { name: "Activar avisos en este dispositivo" });
    await expect(off).toBeVisible();
    await off.click();
    await expect(on).toBeVisible();

    const rows = await service().from("push_subscriptions").select("endpoint, member_id").eq("member_id", a.id);
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([{ endpoint, member_id: a.id }]);
    expect((await service().from("push_subscriptions").select("id").eq("member_id", b.id)).data).toHaveLength(0);

    await on.click();
    await expect(off).toBeVisible();
    await expect.poll(async () => (await service().from("push_subscriptions").select("id").eq("member_id", a.id)).data?.length).toBe(0);
  } finally {
    await context.close();
  }
});

// Subscribing needs a Chromium that has Google API keys and can reach its push service (FCM). The browsers Playwright
// downloads have no API keys, so `pushManager.subscribe` rejects with "Registration failed - permission denied"
// (verified on Playwright's 'chromium' channel with the notifications permission granted and FCM reachable), and the
// default headless shell even reports Notification.permission = "denied". This scenario therefore only runs where a
// push-capable Chromium exists (PUSH_SERVICE_REACHABLE=1, plus PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH pointing at a
// Chrome with API keys). It is not faked: the row must come from a real browser subscription.
test("3. Web Push: con permiso concedido, el interruptor crea la fila en push_subscriptions", async () => {
  test.skip(
    process.env.PUSH_SERVICE_REACHABLE !== "1",
    "needs a Chromium with Google API keys and access to its push service: set PUSH_SERVICE_REACHABLE=1 (and PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH if needed)",
  );
  const browser = await chromium.launch({
    channel: "chromium",
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    const context = await browser.newContext();
    await loginAs(context, keyA);
    await context.grantPermissions(["notifications"], { origin: "http://localhost:3000" });
    const page = await context.newPage();
    await page.goto("/notifications");
    expect(await page.evaluate(() => Notification.permission)).toBe("granted");
    const toggle = page.getByRole("button", { name: "Activar avisos en este dispositivo" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("button", { name: "Desactivar avisos en este dispositivo" })).toBeVisible({ timeout: 30_000 });

    const rows = await service().from("push_subscriptions").select("endpoint, member_id").eq("member_id", a.id);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
    expect((rows.data![0] as { endpoint: string }).endpoint).toMatch(/^https:\/\//);
    // B has none
    const other = await service().from("push_subscriptions").select("id").eq("member_id", b.id);
    expect(other.data).toHaveLength(0);

    await page.getByRole("button", { name: "Desactivar avisos en este dispositivo" }).click();
    await expect(page.getByRole("button", { name: "Activar avisos en este dispositivo" })).toBeVisible();
    await expect.poll(async () => (await service().from("push_subscriptions").select("id").eq("member_id", a.id)).data?.length).toBe(0);
  } finally {
    await browser.close();
  }
});

test("4. sin errores de consola", async () => {
  expect(browserErrors).toEqual([]);
});

test("@screens captura de /notifications a 375 y 1440", async () => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to capture screenshots");
  const OUT = ".superpowers/sdd/f2c/screens";
  mkdirSync(OUT, { recursive: true });
  // a few more notices of different kinds so the list is not a single row
  await openChannel(b.page, "General");
  await sendMention(b.page, NAME_A, " para la captura");
  await expect(messageWith(b.page, "para la captura")).toBeVisible();
  for (const width of [375, 1440] as const) {
    await a.page.setViewportSize({ width, height: 900 });
    await a.page.goto("/notifications");
    await expect(a.page.getByRole("list", { name: "Notificaciones" })).toBeVisible();
    await a.page.waitForLoadState("networkidle");
    await a.page.screenshot({ path: `${OUT}/notifications-${width}.png`, fullPage: true });
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
