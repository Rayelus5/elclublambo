import { createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CHAINS, hardhatAccount } from "./chain/shared.mjs";
import { service } from "./helpers/f2c";
import { installTestWallet, signInPublic, type TestWallet } from "./helpers/wallet";

// P3 acceptance of ElClub Pay (/herramientas/pay, /pay/<alias|address>, /pay/tx/<chainId>/<hash>, /pay/<alias>/badge).
// A (no membership) signs in through the public connect on the tool, creates a profile that receives on Base only and
// copies a link with an amount. B opens it WITHOUT a session (P3-R1: connecting the wallet is enough), sees only Base
// assets (D22), pays USDC and lands on the receipt, read from the chain (P3-R2). Automine is paused on the local Base
// node around the payment so the receipt shows «Pendiente» first, then «Comprobado en la cadena» once a block is mined.
// Injected wallets bound to Hardhat accounts no other spec uses (TEST-ONLY keys, Hardhat's public mnemonic); B gets its
// mock USDC from account 0 in beforeAll. Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const desktop = { width: 1280, height: 900 };
const phone = { width: 375, height: 812 };
const STAMP = Date.now().toString(36);
const ALIAS = `pay_${STAMP}`;
const recipientA = hardhatAccount(13);
const payerB = hardhatAccount(14);
const noProfile = hardhatAccount(15);
const funder = hardhatAccount(0);

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
const usdcOf = (address: string) =>
  publicClient.readContract({ address: CHAINS[BASE].usdc as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
async function node(method: string, params: unknown[] = []) {
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = (await res.json()) as { error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** «Conectar wallet» of the pay widget (no SIWE): opens AppKit and picks MetaMask, retried while the modal animates in. */
async function connectWallet(page: Page, scope: Locator) {
  const connect = scope.getByRole("button", { name: "Conectar wallet" });
  const metamask = page.locator("w3m-modal").getByText("MetaMask").first();
  await expect(async () => {
    if (!(await metamask.isVisible()) && (await connect.isVisible())) await connect.click({ timeout: 5_000 });
    await metamask.click({ timeout: 5_000 });
    await expect(connect).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

let aCtx: BrowserContext;
let aPage: Page;
let bCtx: BrowserContext;
let walletB: TestWallet;
let payLink = "";

test.beforeAll(async ({ browser }) => {
  // B's mock USDC on the local Base node (accounts past MINTED_ACCOUNTS start without it).
  const wallet = createWalletClient({ account: funder.address as `0x${string}`, chain: localChain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({ address: CHAINS[BASE].usdc as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [payerB.address as `0x${string}`, 100_000_000n] });
  expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");

  // A starts without a profile even on a database kept between runs (E2E_SKIP_RESET).
  const wiped = await service().from("public_profiles").delete().eq("wallet_address", recipientA.address.toLowerCase());
  expect(wiped.error).toBeNull();

  aCtx = await browser.newContext({ viewport: desktop, permissions: ["clipboard-read", "clipboard-write"] });
  trackErrors(aCtx);
  await installTestWallet(aCtx, { address: recipientA.address });
  aPage = await aCtx.newPage();
  bCtx = await browser.newContext({ viewport: desktop });
  trackErrors(bCtx);
  walletB = await installTestWallet(bCtx, { address: payerB.address });
});

test.afterAll(async () => {
  // Never leave the shared node paused for the specs that follow.
  await node("evm_setAutomine", [true]).catch(() => {});
  for (const c of [aCtx, bCtx]) await c?.close();
});

test("1. A signs in on /herramientas/pay, creates a Base-only profile and copies a link with an amount", async () => {
  const page = aPage;
  await page.goto("/herramientas/pay");
  await expect(page.getByRole("heading", { level: 1, name: "ElClub Pay" })).toBeVisible();
  await signInPublic(page, page.getByRole("main"));
  await expect(page.getByLabel("Alias de pago")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/herramientas/pay");
  await expect(page.getByText("Tu dirección es pública de todos modos.")).toBeVisible();
  await expect(page.getByText("Si tu dirección es de un exchange o una smart wallet, deja solo la red que admite.")).toBeVisible();

  await page.getByLabel("Alias de pago").fill(ALIAS);
  const arbitrum = page.getByRole("checkbox", { name: "Arbitrum" });
  await expect(arbitrum).toBeChecked();
  await arbitrum.click();
  await expect(arbitrum).not.toBeChecked();
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Perfil guardado.")).toBeVisible();

  const { data, error } = await service().from("public_profiles").select("alias, wallet_address, accept_networks").eq("alias", ALIAS).single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ wallet_address: recipientA.address.toLowerCase(), accept_networks: ["base"] });

  // The link builder appears with the saved profile; only Base assets are offered for the link.
  const linkSection = page.getByRole("region", { name: "Tu enlace de pago" });
  await expect(linkSection).toBeVisible();
  await expect(linkSection.getByRole("radio", { name: /Arbitrum/ })).toHaveCount(0);
  await linkSection.getByLabel("Importe (opcional)").fill("2,5");
  const link = await linkSection.getByLabel("Tu enlace").inputValue();
  const url = new URL(link);
  expect(url.pathname).toBe(`/pay/${ALIAS}`);
  expect(url.searchParams.get("amount")).toBe("2.5");
  await linkSection.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(linkSection.getByText("Enlace copiado.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  payLink = `${url.pathname}${url.search}`;

  // The embeddable button points at the badge image.
  await expect(page.getByRole("region", { name: "Botón para tu web" })).toContainText(`/pay/${ALIAS}/badge`);

  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);
});

test("2. B opens the link without a session, sees only Base, pays USDC and the receipt goes from «Pendiente» to «Comprobado en la cadena»", async () => {
  expect(payLink).not.toBe("");
  const page = await bCtx.newPage();
  await page.goto(payLink);
  await expect(page.getByRole("heading", { level: 1, name: `Pagar a @${ALIAS}` })).toBeVisible();
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);

  const widget = page.getByRole("region", { name: "Pagar" });
  // D22: only the assets of the networks the profile receives on.
  await expect(widget.getByRole("radio", { name: /Base Sepolia/ })).toHaveCount(2);
  await expect(widget.getByRole("radio", { name: /Arbitrum/ })).toHaveCount(0);
  await expect(widget.getByText("Conecta tu wallet para pagar. No hace falta iniciar sesión.")).toBeVisible();
  await connectWallet(page, widget);

  await widget.getByRole("radio", { name: /^USDC\s*Base Sepolia/ }).click();
  await expect(widget.getByLabel("Importe")).toHaveValue("2.5");
  await expect(widget.getByText("Pagas 2,5 USDC en Base Sepolia")).toBeVisible();

  // The previous route may stay mounted but hidden after the client navigation: scope to the receipt itself.
  const receipt = page.getByRole("region", { name: "Recibo de pago" });
  const before = await usdcOf(recipientA.address);
  await node("evm_setAutomine", [false]);
  try {
    await widget.getByRole("button", { name: "Pagar", exact: true }).click();
    await page.waitForURL(/\/pay\/tx\/84532\/0x[0-9a-f]{64}$/i, { timeout: 60_000 });
    expect(walletB.sent).toHaveLength(1);
    expect(new URL(page.url()).pathname.toLowerCase()).toBe(`/pay/tx/${BASE}/${walletB.sent[0]!.toLowerCase()}`);
    await expect(receipt.getByRole("heading", { level: 1, name: "Recibo de pago" })).toBeVisible();
    await expect(receipt.getByText("Pendiente", { exact: true })).toBeVisible();
    await expect(receipt.getByText("Comprobado en la cadena")).toHaveCount(0);
  } finally {
    await node("evm_mine");
    await node("evm_setAutomine", [true]);
  }
  // The page refreshes itself every 5 s until the payment is final.
  await expect(receipt.getByText("Comprobado en la cadena")).toBeVisible({ timeout: 30_000 });
  await expect(receipt.getByText("Pendiente", { exact: true })).toHaveCount(0);
  await expect(receipt.getByText(`@${ALIAS}`, { exact: true })).toBeVisible();
  await expect(receipt.getByText("2,5 USDC", { exact: true })).toBeVisible();
  expect((await usdcOf(recipientA.address)) - before).toBe(2_500_000n);
});

test("3. an address without a profile shows the warning and accepts every network (P3-R4)", async () => {
  const page = await bCtx.newPage();
  await page.goto(`/pay/${noProfile.address}`);
  await expect(page.getByRole("heading", { level: 1, name: "Pagar a esta dirección" })).toBeVisible();
  await expect(page.getByText("Esta dirección no tiene perfil de ElClub Pay")).toBeVisible();
  const widget = page.getByRole("region", { name: "Pagar" });
  await expect(widget.getByRole("radio", { name: /Arbitrum Sepolia/ })).toHaveCount(2);
  await expect(widget.getByRole("radio", { name: /Base Sepolia/ })).toHaveCount(2);
  await page.close();
});

test("4. the badge answers an SVG with the alias", async () => {
  const res = await aPage.request.get(`/pay/${ALIAS}/badge`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/svg+xml");
  const body = await res.text();
  expect(body).toContain("<svg");
  expect(body).toContain(`@${ALIAS}`);
  expect(body).toContain("Pagar con ElClub Pay");
});

test("5. the ES/EN switcher keeps the pay page", async () => {
  const page = aPage;
  await page.goto(`/pay/${ALIAS}`);
  await page.getByRole("navigation", { name: "Idioma" }).getByRole("link", { name: "en" }).click();
  await page.waitForURL((u) => u.pathname === `/en/pay/${ALIAS}`);
  await expect(page.getByRole("heading", { level: 1, name: `Pay @${ALIAS}` })).toBeVisible();
  await page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "es" }).click();
  await page.waitForURL((u) => u.pathname === `/pay/${ALIAS}`);
  await expect(page.getByRole("heading", { level: 1, name: `Pagar a @${ALIAS}` })).toBeVisible();
});

test("6. no console errors along the way", async () => {
  expect(browserErrors).toEqual([]);
});
