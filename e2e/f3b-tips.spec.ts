import { createPublicClient, erc20Abi, http } from "viem";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CHAIN_ID, hardhatAccount, RPC_URL, USDC_ADDRESS } from "./chain/shared.mjs";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { createInvite, joinAs, messageWith, openChannel, rpcAs, send, service, type Actor } from "./helpers/f2c";
import { installTestWallet, type TestWallet } from "./helpers/wallet";

// F3b acceptance on a local Hardhat chain (e2e/chain/start-chain.mjs, started by playwright.config.ts) whose chain id
// and USDC address are Linea Sepolia's, with the server verifying against it (LINEA_SEPOLIA_RPC_URL, TIP_CONFIRMATIONS=1).
// The members sign with an injected EIP-1193/EIP-6963 wallet (e2e/helpers/wallet.ts) bound to a Hardhat account, and log
// in with that same account's key, so the session wallet equals the signer. TEST-ONLY keys (Hardhat's public mnemonic).
// Scenarios share state (the same tipped message, the first tip's hashes): run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const adminAccount = hardhatAccount(1); // == E2E_SUPER_ADMIN_PK
const recipient = hardhatAccount(2); // B, tipped
const tipper = hardhatAccount(3); // A, session wallet and signer
const other = hardhatAccount(4); // a wallet that is NOT A's session wallet
const viewer = hardhatAccount(5); // C, watches live
const platform = hardhatAccount(9); // receives the fee

const MSG_1 = "mensaje de B para propinar";
const MSG_2 = "segundo mensaje de B";
const NAMES = { a: "Propinera A", b: "Receptor B", c: "Observador C" };

const chain = {
  id: CHAIN_ID,
  name: "Local Linea Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;
const usdcBalance = async (address: string) =>
  createPublicClient({ chain, transport: http(RPC_URL) }).readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });

let admin: Actor;
let a: Actor; // tipper, wallet = Hardhat #3
let walletA: TestWallet;
let b: Actor;
let c: Actor; // keeps General open the whole time: the realtime check
let messageId = "";
let firstTip: { main: string; fee: string } | null = null;

/** Joins as a Hardhat account through an invite; the wallet (if any) is injected before any page of the context exists. */
async function member(browser: Browser, pk: `0x${string}`, name: string, inviter: Page) {
  return joinAs(browser, pk, await createInvite(inviter), name);
}

test.beforeAll(async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: desktop });
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };
  expect(addressOf(E2E_SUPER_ADMIN_PK)).toBe(adminAccount.address.toLowerCase());

  a = await member(browser, tipper.privateKey, NAMES.a, admin.page);
  b = await member(browser, recipient.privateKey, NAMES.b, admin.page);
  c = await member(browser, viewer.privateKey, NAMES.c, admin.page);
  for (const x of [a, b, c]) await x.page.setViewportSize(desktop);
  // joinAs already opened a page in A's context; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: tipper.address });
  a.page = await a.context.newPage();
  await a.page.setViewportSize(desktop);
});

test.afterAll(async () => {
  for (const x of [admin, a, b, c]) await x?.context.close();
});

/** Opens the AppKit modal from the dialog's "Conectar wallet" and picks the injected wallet. */
async function connectWallet(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Dar propina" });
  await dialog.getByRole("button", { name: "Conectar wallet" }).click();
  // The modal is mounted outside the Radix dialog: clicking inside it must work while the dialog is open (not trapped).
  const modal = page.locator("w3m-modal");
  await modal.getByText("MetaMask").first().click();
}

/** Reconnects only if the page did not restore the previous connection by itself. */
async function connectIfNeeded(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Dar propina" });
  const ready = dialog.getByRole("button", { name: "Continuar" });
  const connect = dialog.getByRole("button", { name: "Conectar wallet" });
  await expect(connect.or(dialog.getByText(/^Conecta la wallet/)).or(ready)).toBeVisible();
  // Give wagmi time to restore the connection (the connect button shows while it reconnects).
  await page.waitForTimeout(2_000);
  if (await connect.isVisible()) await connectWallet(page);
}

async function openTipFromMessage(page: Page, text: string) {
  await messageWith(page, text).getByRole("button", { name: "Acciones del mensaje" }).click();
  await page.getByRole("menuitem", { name: "Dar propina" }).click();
  await expect(page.getByRole("dialog", { name: "Dar propina" })).toBeVisible();
}

const dbTipsFor = async (fromMember: string) => {
  const { data, error } = await service()
    .from("tips")
    .select("id, intent_id, message_id, main_tx_hash, fee_tx_hash, amount, anonymous")
    .eq("from_member", fromMember)
    .order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as Array<{ id: string; intent_id: string; message_id: string | null; main_tx_hash: string; fee_tx_hash: string | null; amount: string; anonymous: boolean }>;
};

test("1. USDC tip with fee: two signatures, badge live for everyone, thread notice, bell, platform balance +0.26", async () => {
  // Admin sets 2.6 % and the Sepolia platform wallet (a Hardhat account).
  const p = admin.page;
  await p.goto("/settings/economia");
  await expect(p.getByRole("heading", { level: 2, name: "Economía" })).toBeVisible();
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Comisión mínima (%)").fill("2,6");
  await p.getByRole("button", { name: "Guardar comisión" }).click();
  await expect(p.getByText("Comisión guardada.")).toBeVisible();
  await p.getByLabel("Wallet de la plataforma (Linea Sepolia)", { exact: true }).fill(platform.address);
  await p.getByRole("button", { name: "Guardar direcciones de Linea Sepolia" }).click();
  await expect(p.getByText("Direcciones guardadas.")).toBeVisible();

  // B posts; C and A already have General open and see it live.
  await openChannel(c.page, "General");
  await openChannel(b.page, "General");
  await openChannel(a.page, "General");
  await send(b.page, MSG_1);
  await expect(messageWith(b.page, MSG_1)).toBeVisible();
  await expect(messageWith(a.page, MSG_1)).toBeVisible();
  await expect(messageWith(c.page, MSG_1)).toBeVisible();
  messageId = (await messageWith(a.page, MSG_1).getAttribute("data-message-id"))!;
  expect(messageId).toBeTruthy();
  await expect(messageWith(c.page, MSG_1).getByRole("button", { name: /Recompensado/ })).toHaveCount(0);

  const platformBefore = await usdcBalance(platform.address);
  const recipientBefore = await usdcBalance(recipient.address);
  const tipperBefore = await usdcBalance(tipper.address);

  await openTipFromMessage(a.page, MSG_1);
  const dialog = a.page.getByRole("dialog", { name: "Dar propina" });
  // Not connected yet: the dialog asks for it and only the AppKit modal (outside the dialog) can fix it.
  await expect(dialog.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await connectWallet(a.page);
  await expect(dialog.getByRole("button", { name: "Conectar wallet" })).toHaveCount(0);
  // The dialog survived the modal and is interactive again.
  await dialog.getByLabel("Importe").fill("10");
  await expect(dialog.getByTestId("tip-total")).toHaveText("10,26 USDC");
  await dialog.getByRole("button", { name: "Continuar" }).click();

  await expect(dialog.getByText("Propina enviada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(2);

  // Badge: A's own view, B's view, and C's view WITHOUT reloading (realtime refresh).
  for (const viewerPage of [a.page, b.page, c.page]) {
    await expect(messageWith(viewerPage, MSG_1).getByRole("button", { name: /Recompensado · 10 USDC/ })).toBeVisible({ timeout: 30_000 });
  }

  // Thread notice.
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await messageWith(a.page, MSG_1).getByRole("button", { name: "Acciones del mensaje" }).click();
  await a.page.getByRole("menuitem", { name: /hilo/ }).click();
  const panel = a.page.getByRole("complementary", { name: "Panel del hilo" });
  await expect(panel.getByText(/ha enviado 10 USDC a .+ por este mensaje/)).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Cerrar hilo" }).click();

  // B's bell shows a new notice.
  await b.page.goto("/");
  await expect(b.page.getByRole("link", { name: /^Notificaciones, \d+ sin leer$/ })).toBeVisible();

  // Exact money: B +10, platform +0.26, A -10.26.
  expect((await usdcBalance(platform.address)) - platformBefore).toBe(260_000n);
  expect((await usdcBalance(recipient.address)) - recipientBefore).toBe(10_000_000n);
  expect(tipperBefore - (await usdcBalance(tipper.address))).toBe(10_260_000n);

  const tips = await dbTipsFor(a.id);
  expect(tips).toHaveLength(1);
  expect(tips[0]!.message_id).toBe(messageId);
  firstTip = { main: tips[0]!.main_tx_hash, fee: tips[0]!.fee_tx_hash! };
  expect(walletA.sent).toEqual([firstTip.fee, firstTip.main]);
});

test("2. anonymous ETH tip on B's profile: B and a third member see Anónimo, never the donor", async () => {
  await a.page.goto(`/u/${recipient.address.toLowerCase()}`);
  await a.page.getByRole("button", { name: "Dar propina" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Dar propina" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Importe").fill("0,001");
  await dialog.getByRole("radio", { name: "ETH" }).click();
  await connectIfNeeded(a.page);
  await dialog.getByLabel("Propina anónima").check();
  await expect(dialog.getByText(/en la blockchain la transacción es pública/)).toBeVisible();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Propina enviada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(4);

  for (const viewerPage of [c.page, b.page]) {
    await viewerPage.goto(`/u/${recipient.address.toLowerCase()}`);
    await expect(viewerPage.getByText("Anónimo", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(viewerPage.getByText("0,001 ETH").first()).toBeVisible();
    await expect(viewerPage.getByText(NAMES.a)).toHaveCount(0);
    await expect(viewerPage.getByText(addressOf(tipper.privateKey).slice(0, 8), { exact: false })).toHaveCount(0);
  }
  // The donor sees their own tip as theirs.
  await a.page.goto(`/u/${recipient.address.toLowerCase()}`);
  await expect(a.page.getByText("Tú (anónimo)")).toBeVisible();
});

test("3. replay: the first tip's hashes on a new intent are refused with tx_already_used and credit nothing", async () => {
  expect(firstTip).not.toBeNull();
  const created = await rpcAs(a.context, "create_tip_intent", {
    p_target_type: "message",
    p_target_id: messageId,
    p_token: "USDC",
    p_amount: "10000000",
    p_fee_bps: 260,
    p_anonymous: false,
  });
  expect(created.error).toBeNull();
  const intentId = (created.data as { id: string }).id;
  const fee = await rpcAs(a.context, "attach_intent_tx", { p_intent: intentId, p_role: "fee", p_tx_hash: firstTip!.fee });
  const main = await rpcAs(a.context, "attach_intent_tx", { p_intent: intentId, p_role: "main", p_tx_hash: firstTip!.main });
  expect(fee.error).toBeNull();
  expect(main.error).toBeNull();

  // The forum layout re-verifies the member's attached intents after every response.
  const db = service();
  await expect
    .poll(
      async () => {
        await a.page.goto("/");
        const { data } = await db.from("payment_intents").select("status, failure_code").eq("id", intentId).single<{ status: string; failure_code: string | null }>();
        return data;
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toEqual({ status: "failed", failure_code: "tx_already_used" });

  const { count } = await db.from("onchain_transfers").select("*", { count: "exact", head: true }).eq("tx_hash", firstTip!.main);
  expect(count).toBe(1);
  expect((await dbTipsFor(a.id)).filter((t) => t.message_id === messageId)).toHaveLength(1);
});

test("4. wallet on another address than the session: the dialog explains it and nothing is signed", async ({ browser }) => {
  const context = await browser.newContext({ viewport: desktop });
  const wrong = await installTestWallet(context, { address: other.address });
  await loginAs(context, tipper.privateKey); // session = #3, wallet = #4
  const page = await context.newPage();
  const intentsBefore = (await service().from("payment_intents").select("id", { count: "exact", head: true }).eq("member_id", a.id)).count;

  await page.goto("/c/" + (await generalId()));
  await expect(messageWith(page, MSG_1)).toBeVisible();
  await openTipFromMessage(page, MSG_1);
  const dialog = page.getByRole("dialog", { name: "Dar propina" });
  await connectWallet(page);
  await dialog.getByLabel("Importe").fill("1");
  await expect(dialog.getByText(/^Conecta la wallet 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} para enviar\.$/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continuar" })).toBeDisabled();
  expect(wrong.sent).toHaveLength(0);
  expect((await service().from("payment_intents").select("id", { count: "exact", head: true }).eq("member_id", a.id)).count).toBe(intentsBefore);
  await context.close();
});

test("5. interrupted flow: tab closed right after the second signature, the next visit credits the tip exactly once", async ({ browser }) => {
  await send(b.page, MSG_2);
  await expect(messageWith(b.page, MSG_2)).toBeVisible();

  const context = await browser.newContext({ viewport: desktop });
  // From the second signature on, the app cannot reach its server actions (as if the tab died before telling the server).
  let cut = false;
  let secondSigned: () => void = () => undefined;
  const secondSignedP = new Promise<void>((resolve) => (secondSigned = resolve));
  await context.route("**/*", (route) => {
    const r = route.request();
    if (cut && r.method() === "POST" && r.headers()["next-action"]) return route.abort();
    return route.continue();
  });
  const w = await installTestWallet(context, {
    address: tipper.address,
    onSent: (n) => {
      if (n === 2) {
        cut = true;
        secondSigned();
      }
    },
  });
  await loginAs(context, tipper.privateKey);
  const page = await context.newPage();
  await page.goto("/c/" + (await generalId()));
  await expect(messageWith(page, MSG_2)).toBeVisible();
  const msg2 = (await messageWith(page, MSG_2).getAttribute("data-message-id"))!;
  await openTipFromMessage(page, MSG_2);
  const dialog = page.getByRole("dialog", { name: "Dar propina" });
  await connectWallet(page);
  await dialog.getByLabel("Importe").fill("5");
  await dialog.getByRole("button", { name: "Continuar" }).click();

  await secondSignedP;
  // The hash is in the local ledger before the server is told; wait for that, then kill the tab.
  await expect
    .poll(() => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("elclub:pending-sends:")).map(([, v]) => v).join("")), { timeout: 30_000 })
    .toContain('"mainHash"');
  await page.close();
  expect(w.sent).toHaveLength(2);
  const before = (await dbTipsFor(a.id)).filter((t) => t.message_id === msg2);
  expect(before).toHaveLength(0);

  // Next visit: the ledger re-attaches the hash and the server verifies it.
  cut = false;
  const next = await context.newPage();
  await next.goto("/");
  await expect
    .poll(async () => (await dbTipsFor(a.id)).filter((t) => t.message_id === msg2).length, { timeout: 60_000, intervals: [2_000] })
    .toBe(1);
  // Never twice: more visits change nothing.
  await next.reload();
  await next.waitForLoadState("networkidle");
  const after = (await dbTipsFor(a.id)).filter((t) => t.message_id === msg2);
  expect(after).toHaveLength(1);
  expect(after[0]!.main_tx_hash).toBe(w.sent[1]);
  expect(after[0]!.fee_tx_hash).toBe(w.sent[0]);
  await context.close();
});

/** General's id, to open the channel directly in a fresh context. */
async function generalId(): Promise<string> {
  const { data, error } = await service().from("channels").select("id").eq("name", "General").single<{ id: string }>();
  expect(error).toBeNull();
  return data!.id;
}
