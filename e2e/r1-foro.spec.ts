import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addressOf, clubPath, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { channelIds, createInvite, messageWith, send, service } from "./helpers/f2c";

// R1: the club lives under /foro and the root belongs to the public part. Review Focus 1 (a member at / sees the landing
// with «Ir al foro»), 2 (old club URLs 308 to /foro with the same path and query: a shared message link, an invitation)
// and 3 (the club login ends in /foro).
test.describe.configure({ mode: "serial" });

const LANDING_H1 = "Herramientas cripto gratis y seguras";

let admin: BrowserContext;
let adminPage: Page;

test.beforeAll(async ({ browser }) => {
  admin = await browser.newContext();
  await loginAs(admin, E2E_SUPER_ADMIN_PK);
  adminPage = await admin.newPage();
});

test.afterAll(async () => {
  await admin?.close();
});

test("1. the club login ends in /foro (Review Focus 3)", async ({ browser }) => {
  // An anonymous visit to the club goes to its login, under /foro.
  const anon = await browser.newContext();
  const page = await anon.newPage();
  await page.goto(clubPath());
  await page.waitForURL((u) => u.pathname === clubPath("/login"));
  await anon.close();

  // The login hand-off (/foro/login/complete) lands the member in the club home.
  const context = await browser.newContext();
  const landed = await loginAs(context, E2E_SUPER_ADMIN_PK);
  expect(new URL(landed).pathname).toBe(clubPath());
  await context.close();
});

test("2. a member at / sees the landing with «Ir al foro» (Review Focus 1)", async () => {
  await adminPage.goto("/");
  expect(new URL(adminPage.url()).pathname).toBe("/");
  await expect(adminPage.getByRole("heading", { level: 1, name: LANDING_H1 })).toBeVisible();
  await expect(adminPage.getByRole("navigation", { name: "Canales" })).toHaveCount(0);

  const goForum = adminPage.getByRole("group", { name: "Tu cuenta" }).getByRole("link", { name: "Ir al foro" });
  await expect(goForum).toHaveAttribute("href", clubPath());
  await goForum.click();
  await adminPage.waitForURL((u) => u.pathname === clubPath());
  await expect(adminPage.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();

  // /donar is always the public page (R1-R3); the member's club donations live under /foro/donar.
  await adminPage.goto("/donar");
  expect(new URL(adminPage.url()).pathname).toBe("/donar");
});

test("3. an old message link /c/<id>?m=<msg> 308s to /foro/c/<id>?m=<msg> (Review Focus 2)", async ({ request }) => {
  const general = (await channelIds())["General"]!;
  await adminPage.goto(clubPath(`/c/${general}`));
  const text = `enlace antiguo r1 ${Date.now()}`;
  await send(adminPage, text);
  const message = messageWith(adminPage, text);
  await expect(message).toBeVisible();
  const messageId = await message.getAttribute("data-message-id");
  expect(messageId).toBeTruthy();

  const legacy = `/c/${general}?m=${messageId}`;
  const res = await request.get(legacy, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  const location = new URL(res.headers()["location"] ?? "", "http://localhost:3000");
  expect(location.pathname + location.search).toBe(clubPath(legacy));

  // In the browser the member follows it to the message.
  // goto("/") forces a fresh document load, so the legacy URL below is a real navigation through the proxy.
  await adminPage.goto("/");
  await adminPage.goto(legacy);
  await adminPage.waitForURL((u) => u.pathname === clubPath(`/c/${general}`) && u.searchParams.get("m") === messageId);
  await expect(messageWith(adminPage, text)).toBeVisible();

  // Other old club URLs keep their path and query too; /donar exact is the public page and is not redirected.
  for (const path of ["/login", "/sorteos?x=1", "/donar/extra", "/settings/channels"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).toBe(308);
    const to = new URL(r.headers()["location"] ?? "", "http://localhost:3000");
    expect(to.pathname + to.search, path).toBe(clubPath(path));
  }
  expect((await request.get("/donar", { maxRedirects: 0 })).status()).toBe(200);
});

test("4. an old invitation /invite/<code> 308s to /foro/invite/<code> and redeeming it works (Review Focus 2)", async ({
  browser,
  request,
}) => {
  const code = await createInvite(adminPage);
  const res = await request.get(`/invite/${code}`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers()["location"] ?? "", "http://localhost:3000").pathname).toBe(clubPath(`/invite/${code}`));

  // A newcomer opens the old link: the invitation page under /foro offers to connect.
  const pk = newWalletKey();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/invite/${code}`);
  await page.waitForURL((u) => u.pathname === clubPath(`/invite/${code}`));
  await expect(page.getByRole("button", { name: "Conectar wallet" })).toBeVisible();
  await page.close();

  // Signing in with that invitation redeems it and lands in the club.
  const landed = await loginAs(context, pk, { invite: code });
  expect(new URL(landed).pathname).toBe(clubPath());
  const { data: member, error } = await service()
    .from("members")
    .select("status")
    .eq("wallet_address", addressOf(pk))
    .single<{ status: string }>();
  expect(error).toBeNull();
  expect(member?.status).toBe("active");
  await context.close();
});
