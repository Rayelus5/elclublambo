import { createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CHAINS, CLUB_SAFE, hardhatAccount } from "./chain/shared.mjs";
import { E2E_SUPER_ADMIN_PK, handleOf, loginAs } from "./helpers/auth";
import { createInvite, joinAs, service, type Actor } from "./helpers/f2c";
import { installTestWallet, signInPublic, type TestWallet } from "./helpers/wallet";

// P3 acceptance of public donations (/donar for non-members, P3-R7..R10). A wallet without invitation signs in on the
// public /donar and donates USDC to the club Safe on the local Base node, ticking «Aparecer en la lista». A member sees
// «Donante externo · 0x…» in the club's donor list; the public page never shows that list (P3-R8). Then the same wallet
// redeems an invitation: the members insert trigger claims its donation and grants Mecenas (Review Focus 4, P3-R9).
// Injected wallet bound to a Hardhat account no other spec uses (TEST-ONLY keys, Hardhat's public mnemonic); it gets its
// mock USDC from account 0 in beforeAll. Needs a fresh database (the donor must not be a member yet): run serially.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const desktop = { width: 1280, height: 900 };
const phone = { width: 375, height: 812 };
const donor = hardhatAccount(16);
const funder = hardhatAccount(0);
const DONOR = donor.address.toLowerCase();
const EXTERNAL_LABEL = `Donante externo · ${DONOR.slice(0, 6)}…${DONOR.slice(-4)}`;
const LISTED = "Aparecer en la lista de donantes del club como donante externo";

const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

const rpcUrl = CHAINS[BASE].rpcUrl;
const localChain = { id: BASE, name: "Local Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
const safeUsdc = () =>
  publicClient.readContract({ address: CHAINS[BASE].usdc as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [CLUB_SAFE as `0x${string}`] });

type DonationRow = { member_id: string | null; donor_address: string; token: string; usd6: string | number; listed: boolean; anonymous: boolean; public_intent_id: string | null; tx_hash: string };
async function donationsOfDonor(): Promise<DonationRow[]> {
  const { data, error } = await service()
    .from("donations")
    .select("member_id, donor_address, token, usd6, listed, anonymous, public_intent_id, tx_hash")
    .eq("donor_address", DONOR)
    .order("verified_at");
  expect(error).toBeNull();
  return (data ?? []) as DonationRow[];
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The donate form's «Conectar wallet» (when wagmi did not restore the connection): AppKit, then MetaMask. */
async function connectIfNeeded(page: Page, scope: Locator) {
  const connect = scope.getByRole("button", { name: "Conectar wallet" });
  const submit = scope.getByRole("button", { name: "Donar", exact: true });
  await expect(connect.or(submit).first()).toBeVisible();
  await page.waitForTimeout(2_000); // wagmi restores the connection made while signing in
  if (!(await connect.isVisible())) return;
  const metamask = page.locator("w3m-modal").getByText("MetaMask").first();
  await expect(async () => {
    if (!(await metamask.isVisible()) && (await connect.isVisible())) await connect.click({ timeout: 5_000 });
    await metamask.click({ timeout: 5_000 });
    await expect(connect).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

let admin: Actor;
let donorCtx: BrowserContext;
let walletDonor: TestWallet;
const donorList = (page: Page) => page.getByRole("list", { name: "Lista de donantes" });

test.beforeAll(async ({ browser }) => {
  const existing = await service().from("members").select("id").eq("wallet_address", DONOR);
  expect(existing.data ?? [], "the donor must not be a member yet: run on a fresh database").toHaveLength(0);
  const wallet = createWalletClient({ account: funder.address as `0x${string}`, chain: localChain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({ address: CHAINS[BASE].usdc as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [donor.address as `0x${string}`, 50_000_000n] });
  expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");

  const adminContext = await browser.newContext({ viewport: desktop });
  trackErrors(adminContext);
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };

  donorCtx = await browser.newContext({ viewport: desktop });
  trackErrors(donorCtx);
  walletDonor = await installTestWallet(donorCtx, { address: donor.address });
});

test.afterAll(async () => {
  await admin?.context.close();
  await donorCtx?.close();
});

test("1. a wallet without invitation signs in on /donar and donates 5 USDC, listed as an external donor", async () => {
  const page = await donorCtx.newPage();
  await page.goto("/donar");
  await expect(page.getByRole("heading", { level: 1, name: "Donar" })).toBeVisible();
  const panel = page.getByRole("region", { name: "Haz tu donación" });
  await expect(panel.getByText("Entra con tu wallet para donar. Así tu donación queda atada a tu dirección.")).toBeVisible();
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);

  await signInPublic(page, panel);
  await page.waitForURL((u) => u.pathname === "/donar");
  await expect(panel.getByText("Si entras en el club, tus donaciones cuentan para el rol Mecenas.")).toBeVisible();
  await expect(panel.getByText("ElClub. no custodia fondos: la donación va directa a la Safe del club.")).toBeVisible();
  await expect(panel.getByText("Donar no da derechos económicos.")).toBeVisible();
  await connectIfNeeded(page, panel);

  const before = await safeUsdc();
  await panel.getByRole("radio", { name: /^USDC\s*Base Sepolia/ }).click();
  await panel.getByLabel("Importe").fill("5");
  await panel.getByRole("checkbox", { name: LISTED }).click();
  await expect(panel.getByRole("checkbox", { name: LISTED })).toBeChecked();
  await expect(panel.getByText("Donas 5 USDC en Base Sepolia a la Safe del club")).toBeVisible();
  await panel.getByRole("button", { name: "Donar", exact: true }).click();
  await expect(panel.getByText("Donación registrada")).toBeVisible({ timeout: 60_000 });
  expect(walletDonor.sent).toHaveLength(1);
  expect((await safeUsdc()) - before).toBe(5_000_000n);

  const rows = await donationsOfDonor();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ member_id: null, token: "USDC", listed: true, anonymous: false });
  expect(String(rows[0]!.usd6)).toBe("5000000");
  expect(rows[0]!.public_intent_id).not.toBeNull();
  expect(rows[0]!.tx_hash.toLowerCase()).toBe(walletDonor.sent[0]!.toLowerCase());

  // The donor's own total, after a reload.
  await page.reload();
  await expect(panel.getByText("Tu total donado")).toBeVisible();
  await page.close();
});

test("2. a member sees «Donante externo · 0x…» in the club's list; the public page shows no list (P3-R8)", async () => {
  await admin.page.goto("/donar");
  await expect(donorList(admin.page).getByRole("listitem").filter({ hasText: EXTERNAL_LABEL })).toContainText("5 USD");

  const anon = await admin.page.context().browser()!.newContext({ viewport: desktop });
  try {
    trackErrors(anon);
    const page = await anon.newPage();
    await page.goto("/donar");
    await expect(page.getByRole("heading", { level: 1, name: "Donar" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Lo donado" })).toBeVisible();
    await expect(page.getByText("Donante externo", { exact: false })).toHaveCount(0);
    await expect(donorList(page)).toHaveCount(0);
  } finally {
    await anon.close();
  }
});

test("3. the same wallet redeems an invitation: its donation is claimed and it gets Mecenas (Review Focus 4)", async ({ browser }) => {
  const joined = await joinAs(browser, donor.privateKey, await createInvite(admin.page), "Mecenas externo", undefined, trackErrors);
  try {
    const rows = await donationsOfDonor();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.member_id).toBe(joined.id);
    const { data: roles, error } = await service().from("member_roles").select("roles!inner(system_key)").eq("member_id", joined.id).eq("roles.system_key", "donor");
    expect(error).toBeNull();
    expect(roles ?? []).toHaveLength(1);

    // In the club: the member's own state shows Mecenas, and others see the member's label instead of the external one.
    await joined.page.setViewportSize(desktop);
    await joined.page.goto("/donar");
    await expect(joined.page.getByRole("region", { name: "Tu estado" }).getByText("Mecenas", { exact: true })).toBeVisible();
    await admin.page.goto("/donar");
    await expect(donorList(admin.page).getByRole("listitem").filter({ hasText: handleOf(donor.privateKey) })).toContainText("5 USD");
    await expect(donorList(admin.page).getByText(EXTERNAL_LABEL)).toHaveCount(0);
  } finally {
    await joined.context.close();
  }
});

test("4. no console errors along the way", async () => {
  expect(browserErrors).toEqual([]);
});
