import { expect, test, type BrowserContext } from "@playwright/test";
import { hardhatAccount } from "./chain/shared.mjs";
import { clubPath, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { channelIds, createInvite, joinAs } from "./helpers/f2c";
import { installTestWallet, signInPublic } from "./helpers/wallet";

// P2 public accounts (Review Focus 1, D15/D16/D23): a wallet without invitation signs in through the public connect and
// sees nothing of the club; a member signing in on the landing stays on it, with «Ir al foro» (R1). Injected wallets bound to Hardhat
// accounts (TEST-ONLY keys, Hardhat's public mnemonic) that no other spec uses.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const outsider = hardhatAccount(11);
const member = hardhatAccount(12);
const LANDING_H1 = "Herramientas cripto honestas, verificables y gratis.";

const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

test("1. a wallet without invitation signs in on /herramientas: address and «Desconectar»", async ({ browser }) => {
  const context = await browser.newContext({ viewport: desktop });
  trackErrors(context);
  await installTestWallet(context, { address: outsider.address });
  const page = await context.newPage();
  await page.goto("/herramientas");
  await signInPublic(page, page.getByRole("banner"));
  const account = page.getByRole("group", { name: "Tu cuenta" });
  await expect(account.getByText(`${outsider.address.slice(0, 6)}`, { exact: false })).toBeVisible();
  await expect(account.getByRole("button", { name: "Desconectar" })).toBeVisible();
  await expect(account.getByRole("link", { name: "Ir al foro" })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/herramientas");

  // Nothing of the club: a channel sends it to /foro/no-access, / shows the landing.
  const channel = Object.values(await channelIds())[0]!;
  await page.goto(clubPath(`/c/${channel}`));
  await page.waitForURL((u) => u.pathname === clubPath("/no-access"));
  await page.goto("/");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 1, name: LANDING_H1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Canales" })).toHaveCount(0);

  // «Desconectar» ends the session: the connect button is back.
  await page.getByRole("group", { name: "Tu cuenta" }).getByRole("button", { name: "Desconectar" }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: "Conectar wallet" })).toBeVisible();
  await context.close();
});

test("2. a member signing in on the landing stays on it and reaches the forum through «Ir al foro» (R1)", async ({ browser }) => {
  const adminContext = await browser.newContext();
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  const adminPage = await adminContext.newPage();
  const joined = await joinAs(browser, member.privateKey, await createInvite(adminPage), "Miembro público");
  await joined.context.close();
  await adminContext.close();

  const context = await browser.newContext({ viewport: desktop });
  trackErrors(context);
  await installTestWallet(context, { address: member.address });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: LANDING_H1 })).toBeVisible();
  await signInPublic(page, page.getByRole("banner"));
  // R1-R4: the public connect goes back to its `next` (the landing); the club is one click away.
  const goForum = page.getByRole("group", { name: "Tu cuenta" }).getByRole("link", { name: "Ir al foro" });
  await expect(goForum).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 1, name: LANDING_H1 })).toBeVisible();
  await goForum.click();
  await page.waitForURL((u) => u.pathname === clubPath());
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  // The forum is not wrapped in the public tree; after this soft navigation Cache Components keeps the landing in a
  // hidden <Activity>, so only a visible wrapper would be wrong.
  await expect(page.locator("div[lang='es']:visible")).toHaveCount(0);
  await context.close();
});

test("3. no console errors along the way", async () => {
  expect(browserErrors).toEqual([]);
});
