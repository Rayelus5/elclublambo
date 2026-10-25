import { createPublicClient, erc20Abi, http } from "viem";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAINS, CLUB_SAFE, ETH_USD_PRICE_E8, hardhatAccount } from "./chain/shared.mjs";
import { clubPath, E2E_SUPER_ADMIN_PK, handleOf, loginAs } from "./helpers/auth";
import { createInvite, joinAs, rpcAs, service, type Actor } from "./helpers/f2c";
import { connectInjected, installTestWallet, type TestWallet } from "./helpers/wallet";

// P1 acceptance of donations to the club Safe on the two local Hardhat chains (e2e/chain/start-chain.mjs): the Safe
// address has code on both (so donationChains() offers both networks) and a mock Chainlink ETH/USD feed answers 2000 USD
// at ETH_USD_FEED (playwright.config.ts sets ETH_USD_FEED_ADDRESS_<chainId>). A (the donor) signs with an injected wallet
// bound to a Hardhat account and logs in with the same key; C watches from another context. TEST-ONLY keys (Hardhat's
// public mnemonic). Scenarios share state (the first donation's hash, A's visibility): run serially.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const ARB = 421614;
const desktop = { width: 1280, height: 900 };
const donor = hardhatAccount(6); // A
const watcher = hardhatAccount(7); // C
const NAMES = { a: "Mecenas A", c: "Observador C" };
/** How lists name a member: public._member_label gives the @handle first (here the generated @u_<wallet>), not the display name. */
const LABEL_A = handleOf(donor.privateKey);
const DIALOG = "Donar a ElClub.";

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

const client = (chainId: 84532 | 421614) =>
  createPublicClient({
    chain: {
      id: chainId,
      name: `Local ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [CHAINS[chainId].rpcUrl] } },
    },
    transport: http(CHAINS[chainId].rpcUrl),
  });
const safeUsdc = (chainId: 84532 | 421614) =>
  client(chainId).readContract({ address: CHAINS[chainId].usdc as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [CLUB_SAFE as `0x${string}`] });
const safeEth = (chainId: 84532 | 421614) => client(chainId).getBalance({ address: CLUB_SAFE as `0x${string}` });
const walletChain = (page: Page) =>
  page.evaluate(() => (window as unknown as { ethereum: { request(a: { method: string }): Promise<string> } }).ethereum.request({ method: "eth_chainId" }));

type DonationRow = { id: string; chain_id: number; token: string; amount: string | number; usd6: string | number; eth_price_e8: string | number | null; tx_hash: string; anonymous: boolean };
async function donationsOf(memberId: string): Promise<DonationRow[]> {
  const { data, error } = await service()
    .from("donations")
    .select("id, chain_id, token, amount, usd6, eth_price_e8, tx_hash, anonymous")
    .eq("member_id", memberId)
    .order("verified_at");
  expect(error).toBeNull();
  return (data ?? []) as DonationRow[];
}

let admin: Actor;
let a: Actor;
let c: Actor;
let walletA: TestWallet;
let firstHash = "";

test.beforeAll(async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: desktop });
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };

  a = await joinAs(browser, donor.privateKey, await createInvite(admin.page), NAMES.a, undefined, trackErrors);
  c = await joinAs(browser, watcher.privateKey, await createInvite(admin.page), NAMES.c, undefined, trackErrors);
  // joinAs already opened a page in A's context; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: donor.address });
  a.page = await a.context.newPage();
  for (const x of [a, c]) {
    await x.page.setViewportSize(desktop);
    await x.page.goto(clubPath("/donar"));
  }
});

test.afterAll(async () => {
  for (const x of [admin, a, c]) await x?.context.close();
});

const dialogOf = (page: Page) => page.getByRole("dialog", { name: DIALOG });
const assetRow = (page: Page, token: "USDC" | "ETH", network: string) => dialogOf(page).getByRole("radio", { name: new RegExp(`^${token}\\s*${network}`) });

/** Opens the dialog from /donar's header and connects the wallet unless the page restored the connection. */
async function openDonate(page: Page) {
  await page.goto(clubPath("/donar"));
  await page.getByRole("button", { name: DIALOG }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  const connect = dialog.getByRole("button", { name: "Conectar wallet" });
  await expect(connect.or(dialog.getByRole("button", { name: "Continuar" })).first()).toBeVisible();
  await page.waitForTimeout(2_000); // wagmi restores a previous connection meanwhile
  if (await connect.isVisible()) await connectInjected(page, DIALOG);
  return dialog;
}

test("1. 5 USDC on Base Sepolia: one signature, in recent donations and in the list, Mecenas chip and role", async () => {
  const before = await safeUsdc(BASE);
  const dialog = await openDonate(a.page);
  await expect(dialog.getByText("ElClub. no custodia fondos: va directo a la Safe del club. Donar no da derechos económicos.")).toBeVisible();
  await assetRow(a.page, "USDC", "Base Sepolia").click();
  await dialog.getByLabel("Importe").fill("5");
  await expect(dialog.getByTestId("donate-summary")).toContainText("5 USDC");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Donación registrada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(1);
  expect((await safeUsdc(BASE)) - before).toBe(5_000_000n);

  const rows = await donationsOf(a.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ chain_id: BASE, token: "USDC", anonymous: false });
  expect(String(rows[0]!.usd6)).toBe("5000000");
  firstHash = rows[0]!.tx_hash;
  expect(walletA.sent[0]!.toLowerCase()).toBe(firstHash.toLowerCase());

  // The Mecenas role, in the DB.
  const { data: roles, error } = await service().from("member_roles").select("roles!inner(system_key)").eq("member_id", a.id).eq("roles.system_key", "donor");
  expect(error).toBeNull();
  expect(roles ?? []).toHaveLength(1);

  // The page, for A and for C.
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();
  await a.page.reload();
  await expect(a.page.getByRole("region", { name: "Tu estado" }).getByText("Mecenas", { exact: true })).toBeVisible();
  await c.page.goto(clubPath("/donar"));
  const recent = c.page.getByRole("list", { name: "Donaciones recientes" });
  await expect(recent.getByRole("listitem").filter({ hasText: LABEL_A }).filter({ hasText: "5 USDC" })).toHaveCount(1);
  await expect(c.page.getByRole("list", { name: "Lista de donantes" }).getByRole("listitem").filter({ hasText: LABEL_A })).toContainText("5 USD");
});

test("2. ETH on Arbitrum Sepolia: the wallet switches network and usd6 = amount x 2000", async () => {
  const before = await safeEth(ARB);
  const dialog = await openDonate(a.page);
  expect(await walletChain(a.page)).toBe("0x14a34");
  await assetRow(a.page, "ETH", "Arbitrum Sepolia").click();
  await expect.poll(() => walletChain(a.page)).toBe("0x66eee");
  await expect(dialog.getByText("Tu wallet está en otra red.")).toHaveCount(0);
  await dialog.getByLabel("Importe").fill("0,01");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Donación registrada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(2);
  expect((await safeEth(ARB)) - before).toBe(10n ** 16n);

  const row = (await donationsOf(a.id)).find((d) => d.tx_hash.toLowerCase() === walletA.sent[1]!.toLowerCase());
  expect(row).toMatchObject({ chain_id: ARB, token: "ETH" });
  expect(String(row!.amount)).toBe(String(10n ** 16n));
  // 0.01 ETH x 2000 USD = 20 USD, in 6 decimals; the price used is the mock feed's.
  expect(String(row!.usd6)).toBe("20000000");
  expect(String(row!.eth_price_e8)).toBe(String(ETH_USD_PRICE_E8));
});

test("3. anonymous donation: another member sees «Anónimo», never the donor", async () => {
  const dialog = await openDonate(a.page);
  await assetRow(a.page, "USDC", "Base Sepolia").click();
  await expect.poll(() => walletChain(a.page)).toBe("0x14a34");
  await dialog.getByLabel("Importe").fill("1,23");
  await dialog.getByLabel("Donar de forma anónima").check();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Donación registrada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(3);
  expect((await donationsOf(a.id)).at(-1)).toMatchObject({ anonymous: true });

  await c.page.goto(clubPath("/donar"));
  const row = c.page.getByRole("list", { name: "Donaciones recientes" }).getByRole("listitem").filter({ hasText: "1,23 USDC" });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Anónimo", { exact: true })).toBeVisible();
  await expect(row.getByText(LABEL_A)).toHaveCount(0);
  // A's row in the list counts only the public donations for others: 5 USDC + 20 USD of ETH.
  await expect(c.page.getByRole("list", { name: "Lista de donantes" }).getByRole("listitem").filter({ hasText: LABEL_A })).toContainText("25 USD");
});

test("4. with the switch off, the donor leaves the list for everyone else", async () => {
  await a.page.goto(clubPath("/donar"));
  const toggle = a.page.getByRole("checkbox", { name: "Aparecer en la lista de donantes" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await service().from("members").select("donor_visible").eq("id", a.id).single<{ donor_visible: boolean }>()).data?.donor_visible).toBe(false);

  await c.page.goto(clubPath("/donar"));
  await expect(c.page.getByRole("list", { name: "Lista de donantes" }).getByText(LABEL_A)).toHaveCount(0);
  // Their donations still show, unnamed.
  await expect(c.page.getByRole("list", { name: "Donaciones recientes" }).getByText(LABEL_A)).toHaveCount(0);
  // A still sees their own row, marked «Tú».
  await a.page.reload();
  await expect(a.page.getByRole("list", { name: "Lista de donantes" }).getByRole("listitem").filter({ hasText: LABEL_A })).toContainText("Tú");
});

test("5. replay: the first donation's hash on a new intent is refused with tx_already_used", async () => {
  expect(firstHash).not.toBe("");
  const created = await rpcAs(a.context, "create_donation_intent", { p_chain_id: BASE, p_token: "USDC", p_amount: "5000000", p_anonymous: false });
  expect(created.error).toBeNull();
  const intentId = (created.data as { id: string }).id;
  const attached = await rpcAs(a.context, "attach_intent_tx", { p_intent: intentId, p_role: "main", p_tx_hash: firstHash });
  expect(attached.error).toBeNull();

  // The forum layout re-verifies the member's attached intents after a response (at most once per member per 30 s, F5 S2).
  const db = service();
  await expect
    .poll(
      async () => {
        await a.page.goto(clubPath("/donar"));
        const { data } = await db.from("payment_intents").select("status, failure_code").eq("id", intentId).single<{ status: string; failure_code: string | null }>();
        return data;
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toEqual({ status: "failed", failure_code: "tx_already_used" });
  expect(await donationsOf(a.id)).toHaveLength(3);
});

test("6. no console errors along the way", async () => {
  expect(browserErrors).toEqual([]);
});
