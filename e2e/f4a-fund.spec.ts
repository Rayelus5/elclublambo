import { parseAbi, parseEther, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAIN_ID, ETH_USD_FEED_ADDRESS, hardhatAccount, INITIAL_ETH_PRICE_E8, WETH_ADDRESS } from "./chain/shared.mjs";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import {
  acknowledgeDonation,
  ageSnapshots,
  hardhatRpc,
  mineBlock,
  noticesOf,
  operationsList,
  resetLocalDao,
  runCron,
  sendCall,
  sendToken,
  tokenBalance,
} from "./helpers/dao";
import { createInvite, joinAs, service, type Actor } from "./helpers/f2c";
import { connectInjected, installTestWallet, type TestWallet } from "./helpers/wallet";

// F4a acceptance: the fund at market value on the local Hardhat chain (e2e/chain/start-chain.mjs), with the mock
// Chainlink ETH/USD feed and the mock WETH at fixed test addresses (ETH_USD_FEED_ADDRESS_59141 / WETH_ADDRESS_59141 in
// playwright.config.ts; CoinGecko disabled). Snapshots are throttled to one per 55 minutes, so every scenario that needs
// a fresh valuation ages the previous snapshots first (ageSnapshots): nothing depends on wall-clock timing.
// TEST-ONLY keys (Hardhat's public mnemonic). Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const adminAccount = hardhatAccount(1); // == E2E_SUPER_ADMIN_PK, a treasurer (MANAGE_TREASURY)
const memberA = hardhatAccount(6); // A: first donor
const memberB = hardhatAccount(7); // B: second donor, at NAV
const stranger = hardhatAccount(8); // sends USDC and WETH straight to the Safe, outside the app
const platform = hardhatAccount(9); // receives the fee
// The Linea Sepolia Safe: a fresh, unfunded address. The test impersonates it (hardhat_impersonateAccount) for the swap.
const safe = privateKeyToAccount(generatePrivateKey()).address;
// Where the Safe's 5 USDC go in the "swap": any address.
const swapCounterparty = privateKeyToAccount(generatePrivateKey()).address;

const NAMES = { a: "Fondo A", b: "Fondo B" };
const SEPOLIA = "Linea Sepolia";
const NOTE = "Compra de WETH";
const usdc = (n: string) => parseUnits(n, 6);
// The two calls this spec makes on the mocks (e2e/chain/MockAggregator.sol, MockWETH.sol).
const aggregatorAbi = parseAbi(["function setAnswer(int256 newAnswer)"]);
const wethAbi = parseAbi(["function deposit() payable"]);

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
let a: Actor;
let b: Actor;
let walletA: TestWallet;
let walletB: TestWallet;
let sharesBeforeB = 0n;
// The global minimum fee as this spec found it (app_config min_fee_bps); test 1 changes it, afterAll puts it back.
let minFeeBefore: unknown = null;

async function setEthPrice(priceE8: bigint) {
  await sendCall(hardhatAccount(0).address, ETH_USD_FEED_ADDRESS, aggregatorAbi, "setAnswer", [priceE8]);
}

/** Donates `amount` USDC from /dao through the dialog, acknowledgement included. `sharePrice` is the dialog's value per participación. */
async function donate(actor: Actor, wallet: TestWallet, amount: string, sharePrice: string) {
  const p = actor.page;
  await p.goto("/dao");
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Donar a la DAO" }).click();
  const dialog = p.getByRole("dialog", { name: "Donar a la DAO" });
  await expect(dialog).toBeVisible();
  await connectInjected(p, "Donar a la DAO");
  await dialog.getByLabel("Importe").fill(amount);
  await expect(dialog.getByTestId("share-price")).toHaveText(`Valor por participación: ${sharePrice}`);
  // Mandatory legal acknowledgement: "Continuar" stays disabled until it is ticked.
  await expect(dialog.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await acknowledgeDonation(dialog);
  await expect(dialog.getByRole("button", { name: "Continuar" })).toBeEnabled();
  const sentBefore = wallet.sent.length;
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Donación acreditada.")).toBeVisible({ timeout: 60_000 });
  expect(wallet.sent.length - sentBefore).toBe(2); // fee + donation
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click(); // not the X (data-slot="dialog-close")
}

/** "Tu parte: 12,99 USD" -> 12.99 (display only: the assertion tolerates one cent). */
function parseUsd(text: string): number {
  const m = /([\d.]+(?:,\d+)?) USD/.exec(text);
  expect(m, text).not.toBeNull();
  return Number(m![1]!.replaceAll(".", "").replace(",", "."));
}

const ranking = (page: Page) => page.getByRole("table", { name: "Ranking de la DAO" });

test.beforeAll(async ({ browser }) => {
  // This spec checks the very first donation: the local chain's DAO starts from zero whatever ran before.
  await resetLocalDao();
  const fee = await service().from("app_config").select("value").eq("key", "min_fee_bps").single<{ value: unknown }>();
  expect(fee.error).toBeNull();
  minFeeBefore = fee.data!.value;

  const adminContext = await browser.newContext({ viewport: desktop });
  trackErrors(adminContext);
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };
  expect(addressOf(E2E_SUPER_ADMIN_PK)).toBe(adminAccount.address.toLowerCase());
  const adminRow = await service().from("members").select("id").eq("wallet_address", adminAccount.address.toLowerCase()).single<{ id: string }>();
  expect(adminRow.error).toBeNull();
  admin.id = adminRow.data!.id;

  a = await joinAs(browser, memberA.privateKey, await createInvite(admin.page), NAMES.a, undefined, trackErrors);
  b = await joinAs(browser, memberB.privateKey, await createInvite(admin.page), NAMES.b, undefined, trackErrors);
  // joinAs already opened a page; wallet scripts only apply to pages created afterwards.
  for (const [x, account] of [
    [a, memberA],
    [b, memberB],
  ] as const) {
    await x.page.close();
    const wallet = await installTestWallet(x.context, { address: account.address });
    if (x === a) walletA = wallet;
    else walletB = wallet;
    x.page = await x.context.newPage();
    await x.page.setViewportSize(desktop);
  }
});

test.afterAll(async () => {
  for (const x of [admin, a, b]) await x?.context.close();
  // Leave the mock feed as start-chain.mjs set it, and the minimum fee as found, for any later spec.
  await setEthPrice(INITIAL_ETH_PRICE_E8).catch(() => undefined);
  if (minFeeBefore !== null) {
    const { error } = await service().from("app_config").update({ value: minFeeBefore }).eq("key", "min_fee_bps");
    expect(error).toBeNull();
  }
  // Leave chain 59141's DAO clean for later specs and for a real Safe saved on this DB (F4a-R12).
  await resetLocalDao();
});

test("1. setup: the admin sets a fresh Safe and the platform wallet", async () => {
  const p = admin.page;
  await p.goto("/settings/economia");
  await expect(p.getByRole("heading", { level: 2, name: "Economía" })).toBeVisible();
  await p.waitForLoadState("networkidle");
  // A known minimum fee, whatever earlier specs left: each donation is then exactly two transfers (fee + donation).
  // Restored in afterAll.
  await p.getByLabel("Comisión mínima (%)").fill("2,6");
  await p.getByRole("button", { name: "Guardar comisión" }).click();
  await expect(p.getByText("Comisión guardada.")).toBeVisible();
  await p.getByLabel(`Safe (${SEPOLIA})`, { exact: true }).fill(safe);
  await p.getByLabel(`Wallet de la plataforma (${SEPOLIA})`, { exact: true }).fill(platform.address);
  await p.getByRole("button", { name: `Guardar direcciones de ${SEPOLIA}` }).click();
  await expect(p.getByText("Direcciones guardadas.")).toBeVisible();
  expect(await tokenBalance(safe)).toBe(0n);
});

test("2. club fund: 2 USDC already in the Safe belong to the club; A's 10 USDC buy 83,33 % of a 12 USD fund", async () => {
  await sendToken(stranger.address, safe, usdc("2"));

  // Nobody holds shares yet: the dialog prices a participación at 1 USD (F4a-R9).
  await donate(a, walletA, "10", "1 USD");
  expect(await tokenBalance(safe)).toBe(usdc("12"));

  // First cron run on this Safe: first valuation, and the operations scan starts here (no backfill).
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.snapshot).toBe("taken");
  expect(report.scan).toEqual({ inserted: 0, alerts: 0 });

  const p = a.page;
  await p.goto("/dao");
  await expect(p.getByTestId("dao-balance")).toHaveText("12 USD");
  await expect(p.getByTestId("my-share")).toHaveText("83,33 %");
  await expect(p.getByTestId("my-value")).toHaveText("Tu parte: 10 USD");
  await expect(p.getByTestId("my-net")).toHaveText("10 USDC");
  const table = ranking(p);
  await expect(table.getByRole("row", { name: /Fondo del club/ })).toContainText("16,66 %");
  await expect(table.getByRole("row", { name: /\(tú\)/ })).toContainText("83,33 %");
  await expect(p.getByRole("list", { name: "Composición del fondo" })).toContainText("12 USDC");
});

test("3. investment: the Safe swaps 5 USDC for 0,002 WETH and ETH goes to 3000 USD: 13 USD, an unexplained outflow and one alert", async () => {
  // The "swap", as the Safe would do it: 5 USDC out to a counterparty, 0,002 WETH in. Gas comes from a temporary balance
  // that is removed again, so the Safe ends with no native ETH.
  await hardhatRpc("hardhat_setBalance", [safe, "0xde0b6b3a7640000"]);
  await hardhatRpc("hardhat_impersonateAccount", [safe]);
  try {
    await sendToken(safe, swapCounterparty, usdc("5"));
  } finally {
    await hardhatRpc("hardhat_stopImpersonatingAccount", [safe]);
    await hardhatRpc("hardhat_setBalance", [safe, "0x0"]);
  }
  await sendCall(stranger.address, WETH_ADDRESS, wethAbi, "deposit", [], parseEther("0.002"));
  await sendToken(stranger.address, safe, parseEther("0.002"), WETH_ADDRESS);
  await setEthPrice(3000n * 10n ** 8n);
  await mineBlock(); // the scan stops one block below the tip

  await ageSnapshots();
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.snapshot).toBe("taken");
  // A's donation (mined in the tip block the first scan stopped below) + USDC out (alerted) + WETH in.
  expect(report.scan).toEqual({ inserted: 3, alerts: 1 });
  // The donation's inflow is linked to its ledger row (never listed publicly).
  const ops = await service().from("dao_safe_operations").select("asset, direction, amount:amount::text, ledger_id").eq("chain_id", CHAIN_ID);
  expect(ops.error).toBeNull();
  const rows = (ops.data ?? []) as { asset: string; direction: string; amount: string; ledger_id: string | null }[];
  expect(rows.filter((r) => r.ledger_id !== null).map((r) => [r.asset, r.direction, r.amount])).toEqual([["USDC", "in", "10000000"]]);

  const p = admin.page;
  await p.goto("/dao");
  await expect(p.getByTestId("dao-balance")).toHaveText("13 USD");
  const composition = p.getByRole("list", { name: "Composición del fondo" });
  await expect(composition).toContainText("7 USDC");
  await expect(composition).toContainText("0,002 WETH");
  await expect(composition.getByRole("listitem").filter({ hasText: "WETH" })).toContainText("6 USD");
  await expect(p.getByText("Precio ETH: 3.000 USD · Chainlink")).toBeVisible();
  // The NAV chart has at least one point.
  await expect(p.getByRole("img", { name: /^Valor del fondo: de .+ a 13 USD/ })).toBeVisible();

  const out = operationsList(p).getByRole("listitem").filter({ hasText: "5 USDC" });
  await expect(out).toHaveCount(1);
  await expect(out).toContainText("Salida");
  await expect(out.getByText("Sin explicar")).toBeVisible();

  // The treasurer is alerted exactly once, from the bell.
  expect(await noticesOf(admin.id, "treasury_outflow")).toBe(1);
  await p.getByRole("link", { name: /^Notificaciones, \d+ sin leer$/ }).filter({ visible: true }).first().click();
  await expect(p).toHaveURL(/\/notifications$/);
  const notice = p.getByRole("list", { name: "Notificaciones" }).getByRole("link", { name: /Salida de la tesorería sin explicar: 5 USDC/ });
  await expect(notice).toHaveCount(1);
  await notice.click();
  // Ruling F4a-R1: the treasurer panel exists now (F4c), so the notice opens it.
  await expect(p).toHaveURL(/\/dao\/tesoreria$/);
});

test("4. note: the treasurer explains the outflow; members see the note and it no longer alerts", async () => {
  const p = admin.page;
  await p.goto("/dao");
  await p.waitForLoadState("networkidle");
  const out = operationsList(p).getByRole("listitem").filter({ hasText: "5 USDC" });
  await out.getByRole("button", { name: "Añadir nota" }).click();
  await out.getByLabel("Nota de la operación").fill(NOTE);
  await out.getByRole("button", { name: "Guardar" }).click();
  await expect(out).toContainText(NOTE);
  await expect(out.getByText("Sin explicar")).toHaveCount(0);

  // Stored: a member (A) sees the explained outflow after a fresh load, without "Sin explicar".
  await a.page.goto("/dao");
  const seen = operationsList(a.page).getByRole("listitem").filter({ hasText: "5 USDC" });
  await expect(seen).toContainText(NOTE);
  await expect(seen.getByText("Sin explicar")).toHaveCount(0);
  // Members never see the un-noted WETH inflow nor A's own donation inflow: the outflow is the only row.
  await expect(operationsList(a.page).getByRole("listitem")).toHaveCount(1);

  // A later run does not alert again.
  await runCron();
  expect(await noticesOf(admin.id, "treasury_outflow")).toBe(1);
});

test("5. second donor at NAV: B's 13 USDC buy as many shares as the whole fund had, worth 13 USD", async () => {
  const before = await service().from("dao_state").select("total_shares:total_shares::text").eq("chain_id", CHAIN_ID).single<{ total_shares: string }>();
  expect(before.error).toBeNull();
  sharesBeforeB = BigInt(before.data!.total_shares);
  expect(sharesBeforeB).toBeGreaterThan(0n);

  // 13 USD over 12 participaciones.
  await donate(b, walletB, "13", "1,0833 USD");

  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.credited).toBe(0); // already credited by the donation itself (Hardhat finalized = latest)

  const position = await service().from("dao_positions").select("shares:shares::text").eq("chain_id", CHAIN_ID).eq("member_id", b.id).single<{ shares: string }>();
  expect(position.error).toBeNull();
  expect(BigInt(position.data!.shares)).toBe(sharesBeforeB);

  const p = b.page;
  await p.goto("/dao");
  await expect(p.getByTestId("dao-balance")).toHaveText("26 USD");
  await expect(p.getByTestId("my-share")).toHaveText("50 %");
  const mine = parseUsd((await p.getByTestId("my-value").textContent()) ?? "");
  expect(Math.abs(mine - 13)).toBeLessThanOrEqual(0.01);
  await expect(p.getByTestId("my-net")).toHaveText("13 USDC");
});

test("6. no browser errors in any context", () => {
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  expect(browserErrors.filter((e) => !coopOn404(e))).toEqual([]);
});
