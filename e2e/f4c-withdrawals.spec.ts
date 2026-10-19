import { parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CHAIN_ID, hardhatAccount } from "./chain/shared.mjs";
import { addressOf, E2E_SUPER_ADMIN_PK, handleOf, loginAs } from "./helpers/auth";
import {
  acknowledgeDonation,
  ageApproval,
  mineBlock,
  noticesOf,
  operationsList,
  resetLocalDao,
  runCron,
  safeTransfer,
  sendToken,
  tokenBalance,
} from "./helpers/dao";
import { createInvite, joinAs, service, type Actor } from "./helpers/f2c";
import { connectInjected, installTestWallet, type TestWallet } from "./helpers/wallet";

// F4c acceptance: withdrawals on the local Hardhat chain (e2e/chain/start-chain.mjs, mock USDC / WETH / ETH-USD feed).
// SuperAdmin switches withdrawals on, a member asks, a treasurer approves at the market formula (fixing a USDC amount),
// the Safe pays (the hash is pasted, or the cron detects the transfer) and the shares burn at finality (Hardhat:
// finalized = latest). Expiry is made deterministic by moving approved_at into the past (ageApproval) and running the
// cron: no wall-clock waits. TEST-ONLY keys (Hardhat's public mnemonic). Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const phone = { width: 375, height: 800 };
const adminAccount = hardhatAccount(1); // == E2E_SUPER_ADMIN_PK: SuperAdmin and treasurer (MANAGE_TREASURY)
const memberA = hardhatAccount(6); // A: donor who withdraws
const memberB = hardhatAccount(7); // B: plain member (no MANAGE_TREASURY); gets an unexplained payment from the Safe
const stranger = hardhatAccount(8); // tops the Safe up from outside the app
const platform = hardhatAccount(9); // receives the fee
// The Linea Sepolia Safe: a fresh, unfunded address, impersonated for its payouts (safeTransfer).
const safe = privateKeyToAccount(generatePrivateKey()).address;

const NAMES = { a: "Retiro A", b: "Retiro B" };
// The panel labels members by handle (_member_label: handle first, then display name), so A's rows carry the handle.
const LABEL_A = handleOf(memberA.privateKey);
const SEPOLIA = "Linea Sepolia";
const REASON = "Prueba de rechazo";
const usdc = (n: string) => parseUnits(n, 6);

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext, who = "") {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`${who}console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`${who}pageerror: ${e.error().message}`));
}

let admin: Actor;
let a: Actor;
let b: Actor;
let walletA: TestWallet;
let sharePrice = "";

/** "Tu parte: 4,99 USD" -> 4.99 (display only: the assertion tolerates one cent). */
function parseUsd(text: string): number {
  const m = /([\d.]+(?:,\d+)?) USD/.exec(text);
  expect(m, text).not.toBeNull();
  return Number(m![1]!.replaceAll(".", "").replace(",", "."));
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const status = (page: Page) => page.getByTestId("withdrawal-status");
const withdrawButton = (page: Page) => page.getByRole("button", { name: "Retirar", exact: true });
const panelSection = (page: Page, title: string) => page.getByRole("region", { name: title });
const rowOf = (section: Locator, who: string) => section.getByRole("listitem").filter({ hasText: who });

/** A's latest withdrawal request (service role). */
async function latestRequest(): Promise<{ id: string; status: string; amount: string | null }> {
  const { data, error } = await service()
    .from("withdrawal_requests")
    .select("id, status, amount:amount_usdc_locked::text")
    .eq("chain_id", CHAIN_ID)
    .eq("member_id", a.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single<{ id: string; status: string; amount: string | null }>();
  expect(error).toBeNull();
  return data!;
}

/** A's shares on the local chain (0 without a position row). */
async function sharesOfA(): Promise<bigint> {
  const { data, error } = await service()
    .from("dao_positions")
    .select("shares:shares::text")
    .eq("chain_id", CHAIN_ID)
    .eq("member_id", a.id)
    .maybeSingle<{ shares: string }>();
  expect(error).toBeNull();
  return data ? BigInt(data.shares) : 0n;
}

/** A asks for `percent` % from /dao through the dialog and sees it pending. */
async function requestWithdrawal(percent: string, estimate: string) {
  const p = a.page;
  await p.goto("/dao");
  await p.waitForLoadState("networkidle");
  await withdrawButton(p).click();
  const dialog = p.getByRole("dialog", { name: "Retirar participaciones" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Porcentaje (%)").fill(percent);
  await expect(dialog.getByText(`≈ ${estimate} al valor actual. El importe final se fija cuando el tesorero aprueba la retirada.`)).toBeVisible();
  await dialog.getByRole("button", { name: "Pedir retirada" }).click();
  await expect(dialog).toBeHidden();
  await expect(status(p).getByText("Pendiente", { exact: true })).toBeVisible();
  await expect(withdrawButton(p)).toHaveCount(0);
}

/** The admin approves A's pending request from the panel; returns what the dialog showed as the fixed amount. */
async function approveA(amount: string, available: string) {
  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  await rowOf(panelSection(p, "Retiradas pendientes"), LABEL_A).getByRole("button", { name: "Aprobar" }).click();
  const dialog = p.getByRole("dialog", { name: "Aprobar retirada" });
  await expect(dialog.getByText(`Importe que se fijará: ${amount}`)).toBeVisible();
  await expect(dialog.getByText(`USDC disponible en la Safe: ${available}`)).toBeVisible();
  await expect(dialog.getByText(addressOf(memberA.privateKey), { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Aprobar y fijar importe" }).click();
  await expect(dialog.getByText(`Aprobada por ${amount}. Paga desde la Safe y luego pega el hash en «Marcar como pagada», o el foro detectará la transferencia.`)).toBeVisible();
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();
  await expect(rowOf(panelSection(p, "Retiradas aprobadas"), LABEL_A)).toContainText(`Aprobada · ${amount}`);
}

test.beforeAll(async ({ browser }) => {
  // Withdrawals need a known fund: the local chain's DAO starts from zero whatever ran before.
  await resetLocalDao();

  const adminContext = await browser.newContext({ viewport: desktop });
  trackErrors(adminContext);
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };
  expect(addressOf(E2E_SUPER_ADMIN_PK)).toBe(adminAccount.address.toLowerCase());
  const adminRow = await service().from("members").select("id").eq("wallet_address", adminAccount.address.toLowerCase()).single<{ id: string }>();
  expect(adminRow.error).toBeNull();
  admin.id = adminRow.data!.id;

  a = await joinAs(browser, memberA.privateKey, await createInvite(admin.page), NAMES.a, undefined, trackErrors);
  b = await joinAs(browser, memberB.privateKey, await createInvite(admin.page), NAMES.b, undefined, (c) => trackErrors(c, "B "));
  // joinAs already opened a page; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: memberA.address });
  a.page = await a.context.newPage();
  await a.page.setViewportSize(desktop);
  await b.page.setViewportSize(desktop);
});

test.afterAll(async () => {
  for (const x of [admin, a, b]) await x?.context.close();
  // Leave chain 59141's DAO clean (switch off, no requests) for later specs and for a real Safe saved on this DB.
  await resetLocalDao();
});

test("1. setup: a fresh Safe, A's 10 USDC credited; no Retirar while off; the panel is a 404 for a non-treasurer", async () => {
  const p = admin.page;
  await p.goto("/settings/economia");
  await expect(p.getByRole("heading", { level: 2, name: "Economía" })).toBeVisible();
  await p.waitForLoadState("networkidle");
  await p.getByLabel(`Safe (${SEPOLIA})`, { exact: true }).fill(safe);
  await p.getByLabel(`Wallet de la plataforma (${SEPOLIA})`, { exact: true }).fill(platform.address);
  await p.getByRole("button", { name: `Guardar direcciones de ${SEPOLIA}` }).click();
  await expect(p.getByText("Direcciones guardadas.")).toBeVisible();
  expect(await tokenBalance(safe)).toBe(0n);

  // A donates 10 USDC through the dialog (any fee on top), at 1 USD per participación (nobody holds shares yet).
  const pa = a.page;
  await pa.goto("/dao");
  await pa.waitForLoadState("networkidle");
  await pa.getByRole("button", { name: "Donar a la DAO" }).click();
  const dialog = pa.getByRole("dialog", { name: "Donar a la DAO" });
  await expect(dialog).toBeVisible();
  await connectInjected(pa, "Donar a la DAO");
  await dialog.getByLabel("Importe").fill("10");
  await acknowledgeDonation(dialog);
  const sentBefore = walletA.sent.length;
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Donación acreditada.")).toBeVisible({ timeout: 60_000 });
  // The donation, plus the fee when the configured minimum fee is above zero (this spec does not change it).
  expect(walletA.sent.length - sentBefore).toBeGreaterThanOrEqual(1);
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();
  expect(await tokenBalance(safe)).toBe(usdc("10"));

  // The cron's first run on this Safe: first valuation and the scan cursor.
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.snapshot).toBe("taken");

  await pa.goto("/dao");
  await expect(pa.getByTestId("my-value")).toHaveText("Tu parte: 10 USD");
  await expect(pa.getByTestId("my-share")).toHaveText("100 %");
  // The switch is off on this network: no button, no status.
  await expect(withdrawButton(pa)).toHaveCount(0);
  await expect(status(pa)).toHaveCount(0);

  // B does not hold MANAGE_TREASURY: the panel does not exist for them (a real 404).
  const res = await b.page.goto("/dao/tesoreria");
  expect(res?.status()).toBe(404);
});

test("2. switch: the SuperAdmin turns withdrawals on for Linea Sepolia and A sees Retirar (dialog fits 375 px)", async () => {
  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  const toggle = p.getByRole("switch", { name: "Retiradas en Linea Sepolia" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Mainnet stays off.
  await expect(p.getByRole("switch", { name: "Retiradas en Linea", exact: true })).toHaveAttribute("aria-checked", "false");

  const pa = a.page;
  await pa.goto("/dao");
  await pa.waitForLoadState("networkidle");
  await expect(withdrawButton(pa)).toBeVisible();

  // 375 px: /dao with the withdrawal dialog open has no horizontal scroll.
  await pa.setViewportSize(phone);
  await withdrawButton(pa).click();
  const dialog = pa.getByRole("dialog", { name: "Retirar participaciones" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider", { name: "Porcentaje a retirar" })).toBeVisible();
  expect(await noHorizontalScroll(pa)).toBe(true);
  await pa.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await pa.setViewportSize(desktop);
});

test("3. request and cancel: 50 % ≈ 5 USDC, pending, the treasurer is told; cancelled; then 50 % again", async () => {
  await requestWithdrawal("50", "5 USDC");
  expect(await noticesOf(admin.id, "treasury_notice")).toBe(1);

  const p = a.page;
  await status(p).getByRole("button", { name: "Cancelar solicitud" }).click();
  await expect(status(p).getByText("Cancelada", { exact: true })).toBeVisible();
  await expect(withdrawButton(p)).toBeVisible();
  expect((await latestRequest()).status).toBe("cancelled");

  await requestWithdrawal("50", "5 USDC");
  expect((await latestRequest()).status).toBe("pending");
});

test("4. approve: the dialog shows the fixed amount, the Safe's USDC and A's wallet; the share price does not move", async () => {
  const pa = a.page;
  await pa.goto("/dao");
  sharePrice = (await pa.getByTestId("dao-share-price").textContent()) ?? "";
  expect(sharePrice).toBe("1 USD");

  // 375 px: the panel with a pending request has no horizontal scroll.
  const p = admin.page;
  await p.setViewportSize(phone);
  await p.goto("/dao/tesoreria");
  await expect(rowOf(panelSection(p, "Retiradas pendientes"), LABEL_A)).toBeVisible();
  expect(await noHorizontalScroll(p)).toBe(true);
  await p.setViewportSize(desktop);

  await approveA("5 USDC", "10 USDC");
  expect((await latestRequest()).amount).toBe("5000000");

  await pa.goto("/dao");
  await expect(status(pa).getByText("Aprobada · importe fijado: 5 USDC")).toBeVisible();
  // An approval never moves the price for the others: shares leave the supply and the amount becomes a liability.
  await expect(pa.getByTestId("dao-share-price")).toHaveText(sharePrice);
  // The bell carries the approval.
  expect(await noticesOf(a.id, "withdrawal_approved")).toBe(1);
  await pa.getByRole("link", { name: /^Notificaciones, \d+ sin leer$/ }).filter({ visible: true }).first().click();
  await expect(pa).toHaveURL(/\/notifications$/);
  await expect(pa.getByRole("list", { name: "Notificaciones" }).getByRole("link", { name: /Tu retirada de 5 USDC está aprobada/ })).toHaveCount(1);
});

test("5. pay by hash: the pasted transfer is verified, the cron burns at finality, the outflow is explained", async () => {
  const hash = await safeTransfer(safe, memberA.address, usdc("5"));

  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  await rowOf(panelSection(p, "Retiradas aprobadas"), LABEL_A).getByRole("button", { name: "Marcar como pagada" }).click();
  const dialog = p.getByRole("dialog", { name: "Marcar como pagada" });
  await dialog.getByLabel("Hash de la transacción").fill(hash);
  await dialog.getByRole("button", { name: "Comprobar pago" }).click();
  await expect(dialog.getByText("Pago verificado. Las participaciones se quemarán cuando la red lo finalice.")).toBeVisible();
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();

  await mineBlock(); // the scan stops one block below the tip
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.payouts).toMatchObject({ paid: 1, reverted: 0 });
  expect((await latestRequest()).status).toBe("paid");

  const pa = a.page;
  await pa.goto("/dao");
  await expect(status(pa).getByText("Pagada", { exact: true })).toBeVisible();
  const mine = parseUsd((await pa.getByTestId("my-value").textContent()) ?? "");
  expect(Math.abs(mine - 5)).toBeLessThanOrEqual(0.01);
  // The payout is explained in the public feed, without naming who it paid.
  const out = operationsList(pa).getByRole("listitem").filter({ hasText: "5 USDC" });
  await expect(out).toHaveCount(1);
  await expect(out).toContainText("Retirada de un miembro");
  await expect(out.getByText("Sin explicar")).toHaveCount(0);
  await expect(out).not.toContainText(LABEL_A);
  await expect(out).not.toContainText(NAMES.a);
  await expect(out).not.toContainText(addressOf(memberA.privateKey).slice(0, 6));
  // A real payout never alerts the treasurers.
  expect(await noticesOf(admin.id, "treasury_outflow")).toBe(0);
});

test("6. reject, expiry and auto-detection", async () => {
  const pa = a.page;
  const p = admin.page;

  // Reject: A asks for everything, the treasurer refuses with a reason.
  await requestWithdrawal("100", "5 USDC");
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  await rowOf(panelSection(p, "Retiradas pendientes"), LABEL_A).getByRole("button", { name: "Rechazar" }).click();
  const reject = p.getByRole("dialog", { name: "Rechazar retirada" });
  await reject.getByLabel("Motivo").fill(REASON);
  await reject.getByRole("button", { name: "Rechazar" }).click();
  await expect(reject).toBeHidden();
  await pa.goto("/dao");
  await expect(status(pa).getByText(`Rechazada: ${REASON}`)).toBeVisible();
  expect(await noticesOf(a.id, "withdrawal_rejected")).toBe(1);

  // Expiry: approved, then 15 days old; the cron sends it back to pending (shares still locked).
  await requestWithdrawal("100", "5 USDC");
  await approveA("5 USDC", "5 USDC");
  const req = await latestRequest();
  await ageApproval(req.id, 15);
  const expired = await runCron();
  expect(expired.error).toBeUndefined();
  expect(expired.expiredApprovals).toBe(1);
  await pa.goto("/dao");
  await expect(status(pa).getByText("Caducada · pendiente de nueva aprobación", { exact: true })).toBeVisible();
  expect(await noticesOf(a.id, "withdrawal_expired")).toBe(1);
  await p.goto("/dao/tesoreria");
  await expect(rowOf(panelSection(p, "Retiradas pendientes"), LABEL_A)).toContainText("Caducada · pendiente de nueva aprobación");

  // Re-approval at the current price.
  await approveA("5 USDC", "5 USDC");
  const again = await latestRequest();
  expect(again.status).toBe("approved");

  // Ruling F4c-R3/R6: while a detected outflow waits for verification, Rechazar is disabled and says why. The link is
  // simulated with a service-role row (on Hardhat a real one is verified in the same cron run) and removed at once.
  const fake = await service()
    .from("dao_safe_operations")
    .insert({
      chain_id: CHAIN_ID,
      tx_hash: `0x${"ab".repeat(32)}`,
      log_index: 0,
      asset: "USDC",
      direction: "out",
      amount: again.amount,
      counterparty: addressOf(memberA.privateKey),
      block_number: 1,
      occurred_at: new Date().toISOString(),
      withdrawal_id: again.id,
    })
    .select("id")
    .single<{ id: string }>();
  expect(fake.error).toBeNull();
  try {
    await p.goto("/dao/tesoreria");
    const row = rowOf(panelSection(p, "Retiradas aprobadas"), LABEL_A);
    await expect(row.getByRole("button", { name: "Rechazar" })).toBeDisabled();
    await expect(row.getByText("Hay un pago detectado pendiente de verificar.")).toBeVisible();
  } finally {
    const del = await service().from("dao_safe_operations").delete().eq("id", fake.data!.id);
    expect(del.error).toBeNull();
  }

  // Auto-detection: the Safe pays without anyone pasting the hash; the cron links, verifies, records and burns.
  await safeTransfer(safe, memberA.address, BigInt(again.amount!));
  await mineBlock();
  const detected = await runCron();
  expect(detected.error).toBeUndefined();
  expect(detected.payouts).toMatchObject({ recorded: 1, paid: 1, reverted: 0 });
  await pa.goto("/dao");
  await expect(status(pa).getByText("Pagada", { exact: true })).toBeVisible();
  expect(await sharesOfA()).toBe(0n);
  expect(await noticesOf(admin.id, "treasury_outflow")).toBe(0);
});

test("7. unmatched transfer: the Safe pays B, who never asked; one alert and the panel lists it as unexplained", async () => {
  await sendToken(stranger.address, safe, usdc("1")); // the Safe was emptied by the two payouts
  await safeTransfer(safe, memberB.address, usdc("1"));
  await mineBlock();
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.scan).toMatchObject({ alerts: 1 });
  expect(await noticesOf(admin.id, "treasury_outflow")).toBe(1);

  const p = admin.page;
  await p.goto("/dao/tesoreria");
  const unexplained = panelSection(p, "Operaciones sin explicar");
  await expect(unexplained.getByRole("listitem").filter({ hasText: "1 USDC" })).toHaveCount(1);
  await expect(panelSection(p, "Avisos").getByRole("link", { name: "1 salida sin explicar" })).toBeVisible();
  // The paid withdrawals are explained, so they are not listed.
  await expect(unexplained.getByRole("listitem").filter({ hasText: "5 USDC" })).toHaveCount(0);
});

test("8. no browser errors in any context", () => {
  const coopOn404 = (e: string) => /^(B )?console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  // Test 1 asserts B's 404 on the panel on purpose and Chrome logs that response as a console error: allowed for B only.
  const expectedPanel404 = (e: string) =>
    /^B console: Failed to load resource: the server responded with a status of 404 \(Not Found\) @ http:\/\/localhost:3000\/dao\/tesoreria /.test(e);
  expect(browserErrors.filter((e) => !coopOn404(e) && !expectedPanel404(e))).toEqual([]);
});
