import { createPublicClient, erc20Abi, http } from "viem";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CHAINS, hardhatAccount } from "./chain/shared.mjs";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { createInvite, joinAs, messageWith, openChannel, rpcAs, send, service, type Actor } from "./helpers/f2c";
import { watchCsp } from "./helpers/csp";
import { connectInjected, installTestWallet, type TestWallet } from "./helpers/wallet";
import { builderCodeSuffix, ERC8021_MARKER } from "../src/lib/web3/builder-code";

// P0 acceptance of tips on two local Hardhat chains (e2e/chain/start-chain.mjs, started by playwright.config.ts): Base
// Sepolia (84532, :8545) and Arbitrum Sepolia (421614, :8546), each with a mock USDC at Circle's address for that testnet.
// The server verifies against them (BASE_SEPOLIA_RPC_URL / ARBITRUM_SEPOLIA_RPC_URL, TIP_CONFIRMATIONS=1). A tip is one
// transfer, no fee. The members sign with an injected EIP-1193/EIP-6963 wallet (e2e/helpers/wallet.ts) that really
// switches networks, bound to a Hardhat account, and log in with that same account's key, so the session wallet equals
// the signer. TEST-ONLY keys (Hardhat's public mnemonic). Scenarios share state (the same tipped message, the first
// tip's hash): run serially.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const ARB = 421614;
/** playwright.config.ts sets NEXT_PUBLIC_BASE_BUILDER_CODE to this TEST-ONLY code. */
const BUILDER_CODE = "bc_e2etest";

const desktop = { width: 1280, height: 900 };
const adminAccount = hardhatAccount(1); // == E2E_SUPER_ADMIN_PK
const recipient = hardhatAccount(2); // B, tipped
const tipper = hardhatAccount(3); // A, session wallet and signer
const other = hardhatAccount(4); // a wallet that is NOT A's session wallet
const viewer = hardhatAccount(5); // C, watches live

const MSG_1 = "mensaje de B para propinar";
const MSG_2 = "segundo mensaje de B";
const NAMES = { a: "Propinera A", b: "Receptor B", c: "Observador C" };

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
const usdcBalance = (chainId: 84532 | 421614, address: string) =>
  client(chainId).readContract({
    address: CHAINS[chainId].usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
/** The calldata the node mined for `hash` (eth_getTransactionByHash on that chain's node). */
const txInput = async (chainId: 84532 | 421614, hash: string) =>
  (await client(chainId).getTransaction({ hash: hash as `0x${string}` })).input.toLowerCase();

let admin: Actor;
let a: Actor; // tipper, wallet = Hardhat #3
let walletA: TestWallet;
let b: Actor;
let c: Actor; // keeps General open the whole time: the realtime check
let messageId = "";
let firstTipHash = "";
/** A's CSP watcher (test 1), read again after the Arbitrum tip: a page can only expose the watcher's binding once. */
let cspA: () => Promise<string[]> = async () => [];

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
  for (const x of [a, b, c]) {
    await x.page.setViewportSize(desktop);
    await x.page.goto("/"); // joinAs leaves its page blank
  }
  // joinAs already opened a page in A's context; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: tipper.address });
  a.page = await a.context.newPage();
  await a.page.goto("/");
  await a.page.setViewportSize(desktop);
});

test.afterAll(async () => {
  for (const x of [admin, a, b, c]) await x?.context.close();
});

/** Opens the AppKit modal from the dialog's "Conectar wallet" and picks the injected wallet. */
async function connectWallet(page: Page) {
  // The modal is mounted outside the Radix dialog: clicking inside it must work while the dialog is open (not trapped).
  await connectInjected(page, "Dar propina");
}

/** Reconnects only if the page did not restore the previous connection by itself. */
async function connectIfNeeded(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Dar propina" });
  const ready = dialog.getByRole("button", { name: "Continuar" });
  const connect = dialog.getByRole("button", { name: "Conectar wallet" });
  await expect(connect.or(dialog.getByText(/^Conecta la wallet/)).or(ready).first()).toBeVisible();
  // Give wagmi time to restore the connection (the connect button shows while it reconnects).
  await page.waitForTimeout(2_000);
  if (await connect.isVisible()) await connectWallet(page);
}

async function openTipFromMessage(page: Page, text: string) {
  await messageWith(page, text).getByRole("button", { name: "Acciones del mensaje" }).click();
  await page.getByRole("menuitem", { name: "Dar propina" }).click();
  await expect(page.getByRole("dialog", { name: "Dar propina" })).toBeVisible();
}

/** The asset picker's row for `token` on the network named `network` ("USDC" + "Base Sepolia" + its balance). */
const assetRow = (page: Page, token: "USDC" | "ETH", network: string) =>
  page.getByRole("dialog", { name: "Dar propina" }).getByRole("radio", { name: new RegExp(`^${token}\\s*${network}`) });

const dbTipsFor = async (fromMember: string) => {
  const { data, error } = await service()
    .from("tips")
    .select("id, intent_id, message_id, chain_id, main_tx_hash, fee_tx_hash, amount, anonymous")
    .eq("from_member", fromMember)
    .order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as Array<{
    id: string;
    intent_id: string;
    message_id: string | null;
    chain_id: number;
    main_tx_hash: string;
    fee_tx_hash: string | null;
    amount: string | number;
    anonymous: boolean;
  }>;
};

test("1. USDC tip on Base Sepolia: one signature, no fee, Builder Code suffix, badge live for everyone, thread notice, bell", async () => {
  // F5 Task 3: the whole payment (AppKit modal, wallet RPC, Realtime badge) runs under the full CSP without a violation.
  cspA = await watchCsp(a.page);
  const cspB = await watchCsp(b.page); // the tip receiver: badge, thread notice and bell arrive live on its page
  await a.page.reload(); // the watcher's init script applies from the next document on
  await b.page.reload();

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

  const recipientBefore = await usdcBalance(BASE, recipient.address);
  const tipperBefore = await usdcBalance(BASE, tipper.address);

  await openTipFromMessage(a.page, MSG_1);
  const dialog = a.page.getByRole("dialog", { name: "Dar propina" });
  // Not connected yet: the dialog asks for it and only the AppKit modal (outside the dialog) can fix it.
  await expect(dialog.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await connectWallet(a.page);
  await expect(dialog.getByRole("button", { name: "Conectar wallet" })).toHaveCount(0);
  // The dialog survived the modal and is interactive again. Token first: USDC on Base Sepolia.
  await assetRow(a.page, "USDC", "Base Sepolia").click();
  await expect(assetRow(a.page, "USDC", "Base Sepolia")).toHaveAttribute("aria-checked", "true");
  await dialog.getByLabel("Importe").fill("10");
  // No fee: the summary is exactly what B gets.
  await expect(dialog.getByTestId("tip-summary")).toContainText("10 USDC");
  await expect(dialog.getByText("ElClub. no custodia fondos: va directo a su wallet.")).toBeVisible();
  await dialog.getByRole("button", { name: "Continuar" }).click();

  await expect(dialog.getByText("Propina enviada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(1);

  // Badge: A's own view, B's view, and C's view WITHOUT reloading (realtime refresh).
  for (const viewerPage of [a.page, b.page, c.page]) {
    await expect(messageWith(viewerPage, MSG_1).getByRole("button", { name: /Recompensado · 10 USDC/ })).toBeVisible({ timeout: 30_000 });
  }

  // Thread notice.
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click(); // not the X (data-slot="dialog-close")
  await messageWith(a.page, MSG_1).getByRole("button", { name: "Acciones del mensaje" }).click();
  await a.page.getByRole("menuitem", { name: /hilo/ }).click();
  const panel = a.page.getByRole("complementary", { name: "Panel del hilo" });
  await expect(panel.getByText(/ha enviado 10 USDC a .+ por este mensaje/)).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Cerrar hilo" }).click();

  // B's bell shows a new notice.
  await b.page.goto("/");
  await expect(b.page.getByRole("link", { name: /^Notificaciones, \d+ sin leer$/ })).toBeVisible();

  // Exact money, one transfer: B +10, A -10.
  expect((await usdcBalance(BASE, recipient.address)) - recipientBefore).toBe(10_000_000n);
  expect(tipperBefore - (await usdcBalance(BASE, tipper.address))).toBe(10_000_000n);

  const tips = await dbTipsFor(a.id);
  expect(tips).toHaveLength(1);
  expect(tips[0]).toMatchObject({ message_id: messageId, chain_id: BASE, fee_tx_hash: null });
  firstTipHash = tips[0]!.main_tx_hash;
  expect(walletA.sent).toEqual([firstTipHash]);

  // Builder Code (ERC-8021): the Base transfer's calldata ends with the configured code's suffix.
  expect(await txInput(BASE, firstTipHash)).toMatch(new RegExp(`${builderCodeSuffix([BUILDER_CODE]).slice(2).toLowerCase()}$`));

  expect(await cspA()).toEqual([]);
  expect(await cspB()).toEqual([]);
});

test("2. USDC tip on Arbitrum Sepolia from B's profile: the wallet switches network by itself and the tip is credited on 421614", async () => {
  await a.page.goto(`/u/${recipient.address.toLowerCase()}`);
  await a.page.getByRole("button", { name: "Dar propina" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Dar propina" });
  await expect(dialog).toBeVisible();
  await connectIfNeeded(a.page);
  const recipientBefore = await usdcBalance(ARB, recipient.address);
  const baseBefore = await usdcBalance(BASE, recipient.address);

  // The wallet starts on Base Sepolia; picking the Arbitrum row asks it to switch, with no extra click.
  expect(await a.page.evaluate(() => (window as unknown as { ethereum: { request(a: { method: string }): Promise<string> } }).ethereum.request({ method: "eth_chainId" }))).toBe("0x14a34");
  await assetRow(a.page, "USDC", "Arbitrum Sepolia").click();
  await expect(assetRow(a.page, "USDC", "Arbitrum Sepolia")).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() => a.page.evaluate(() => (window as unknown as { ethereum: { request(a: { method: string }): Promise<string> } }).ethereum.request({ method: "eth_chainId" })))
    .toBe("0x66eee");
  await expect(dialog.getByText("Tu wallet está en otra red.")).toHaveCount(0);
  await expect(dialog.getByText("En Arbitrum solo vale USDC nativo (no USDC.e).")).toBeVisible();

  await dialog.getByLabel("Importe").fill("2");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Propina enviada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(2);

  // The money moved on Arbitrum Sepolia only.
  expect((await usdcBalance(ARB, recipient.address)) - recipientBefore).toBe(2_000_000n);
  expect(await usdcBalance(BASE, recipient.address)).toBe(baseBefore);
  const tip = (await dbTipsFor(a.id)).find((t) => t.main_tx_hash === walletA.sent[1]);
  expect(tip).toMatchObject({ chain_id: ARB, message_id: null });
  expect(String(tip!.amount)).toBe("2000000");
  // Never a Builder Code on Arbitrum.
  expect(await txInput(ARB, walletA.sent[1]!)).not.toContain(ERC8021_MARKER.slice(2));
  expect(await cspA()).toEqual([]);
});

test("3. anonymous ETH tip on B's profile: B and a third member see Anónimo, never the donor", async () => {
  await a.page.goto(`/u/${recipient.address.toLowerCase()}`);
  await a.page.getByRole("button", { name: "Dar propina" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Dar propina" });
  await expect(dialog).toBeVisible();
  await connectIfNeeded(a.page);
  await assetRow(a.page, "ETH", "Base Sepolia").click();
  await dialog.getByLabel("Importe").fill("0,001");
  await dialog.getByLabel("Propina anónima").check();
  await expect(dialog.getByText(/en la blockchain la transacción es pública/)).toBeVisible();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Propina enviada")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(3);

  for (const viewerPage of [c.page, b.page]) {
    await viewerPage.goto(`/u/${recipient.address.toLowerCase()}`);
    // B's profile also lists the public tips from A, so check the anonymous tip's own row.
    const received = viewerPage.getByRole("region", { name: "Propinas recibidas" });
    const row = received.getByRole("listitem").filter({ hasText: "0,001 ETH" });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.getByText("Anónimo", { exact: true })).toBeVisible();
    await expect(row.getByText(NAMES.a)).toHaveCount(0);
    await expect(row.getByText(addressOf(tipper.privateKey).slice(0, 8), { exact: false })).toHaveCount(0);
    // No explorer link that would reveal the sender (F3d-R3).
    await expect(row.getByRole("link", { name: "Ver transacción en el explorador" })).toHaveCount(0);
  }
  // The donor sees their own tip as theirs.
  await a.page.goto(`/u/${recipient.address.toLowerCase()}`);
  await expect(a.page.getByText("Tú (anónimo)")).toBeVisible();
});

test("4. receive networks: with B accepting Base only, the picker never offers Arbitrum Sepolia", async () => {
  const db = service();
  const set = await db.from("members").update({ receive_networks: ["base"] }).eq("id", b.id);
  expect(set.error).toBeNull();
  try {
    await a.page.goto("/c/" + (await generalId()));
    await expect(messageWith(a.page, MSG_1)).toBeVisible();
    await openTipFromMessage(a.page, MSG_1);
    const dialog = a.page.getByRole("dialog", { name: "Dar propina" });
    await expect(assetRow(a.page, "USDC", "Base Sepolia")).toBeVisible();
    await expect(assetRow(a.page, "ETH", "Base Sepolia")).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(dialog.getByText(/Arbitrum/)).toHaveCount(0);
  } finally {
    const reset = await db.from("members").update({ receive_networks: ["base", "arbitrum"] }).eq("id", b.id);
    expect(reset.error).toBeNull();
  }
});

test("5. replay: the first tip's hash on a new intent is refused with tx_already_used and credits nothing", async () => {
  expect(firstTipHash).not.toBe("");
  const created = await rpcAs(a.context, "create_tip_intent", {
    p_target_type: "message",
    p_target_id: messageId,
    p_chain_id: BASE,
    p_token: "USDC",
    p_amount: "10000000",
    p_anonymous: false,
  });
  expect(created.error).toBeNull();
  const intentId = (created.data as { id: string }).id;
  const main = await rpcAs(a.context, "attach_intent_tx", { p_intent: intentId, p_role: "main", p_tx_hash: firstTipHash });
  expect(main.error).toBeNull();

  // The forum layout re-verifies the member's attached intents after a response (at most once per member per 30 s, F5 S2).
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

  const { count } = await db.from("onchain_transfers").select("*", { count: "exact", head: true }).eq("tx_hash", firstTipHash);
  expect(count).toBe(1);
  expect((await dbTipsFor(a.id)).filter((t) => t.message_id === messageId)).toHaveLength(1);
});

test("6. wallet on another address than the session: the dialog explains it and nothing is signed", async ({ browser }) => {
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

test("7. interrupted flow: tab closed right after the signature, the next visit credits the tip exactly once", async ({ browser }) => {
  await b.page.goto("/c/" + (await generalId())); // an earlier test left B on a profile
  await send(b.page, MSG_2);
  await expect(messageWith(b.page, MSG_2)).toBeVisible();

  const context = await browser.newContext({ viewport: desktop });
  // From the signature on, the app cannot reach its server actions (as if the tab died before telling the server).
  let cut = false;
  let signed: () => void = () => undefined;
  const signedP = new Promise<void>((resolve) => (signed = resolve));
  await context.route("**/*", (route) => {
    const r = route.request();
    if (cut && r.method() === "POST" && r.headers()["next-action"]) return route.abort();
    return route.continue();
  });
  const w = await installTestWallet(context, {
    address: tipper.address,
    onSent: (n) => {
      if (n === 1) {
        cut = true;
        signed();
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
  await assetRow(page, "USDC", "Base Sepolia").click();
  await dialog.getByLabel("Importe").fill("5");
  await dialog.getByRole("button", { name: "Continuar" }).click();

  await signedP;
  // The hash is in the local ledger before the server is told; wait for that, then kill the tab.
  await expect
    .poll(() => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("elclub:pending-sends:")).map(([, v]) => v).join("")), { timeout: 30_000 })
    .toContain('"mainHash"');
  await page.close();
  expect(w.sent).toHaveLength(1);
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
  expect(after[0]).toMatchObject({ main_tx_hash: w.sent[0], fee_tx_hash: null, chain_id: BASE });
  await context.close();
});

/** General's id, to open the channel directly in a fresh context. */
async function generalId(): Promise<string> {
  const { data, error } = await service().from("channels").select("id").eq("name", "General").single<{ id: string }>();
  expect(error).toBeNull();
  return data!.id;
}
