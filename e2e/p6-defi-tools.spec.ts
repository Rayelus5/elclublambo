import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, http, maxUint256, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAINS, hardhatAccount } from "./chain/shared.mjs";
import { MOCK_CHECKER_BASE } from "./mock/checker.mjs";
import { watchCsp } from "./helpers/csp";
import { service } from "./helpers/f2c";
import { installTestWallet, type TestWallet } from "./helpers/wallet";
import { encodeLines } from "../src/lib/multisend/fragment";
import { builderCodeSuffix } from "../src/lib/web3/builder-code";

// P6 acceptance of the DeFi tools (Aprobaciones, Envío múltiple + Repartir gastos, Gas) on the local nodes.
// A (Hardhat 1) approves SPENDER (Hardhat 9, an account without code) straight to the node; anyone sees it on
// /herramientas/aprobaciones, A connects (no SIWE) and revokes it (Builder Code suffix, allowance 0 on chain). Review
// Focus 1: with Blockscout's getLogs down (mock /__logs/fail) the page says so and the manual check finds a 5 USDC approval.
// A multisends 10 + 20 + 0,5 USDC to Hardhat 5, 6 and 7 one by one (the e2e wallet has no EIP-5792), and a new #envio=
// during the run changes neither the list nor what is signed. Review Focus 4: the 2nd signature of a 2-line list is
// rejected, and «Continuar» sends only that line. Then the split, the gas page and the ES/EN switch.
// TEST-ONLY wallets: Hardhat accounts (public mnemonic). Scenarios share state: serial.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const desktop = { width: 1280, height: 900 };
const phone = { width: 375, height: 812 };
const ownerA = hardhatAccount(1);
const A = ownerA.address;
const SPENDER = hardhatAccount(9).address;
const [R5, R6, R7] = [hardhatAccount(5).address, hardhatAccount(6).address, hardhatAccount(7).address];
const USDC = CHAINS[BASE].usdc as `0x${string}`;
const SUFFIX = builderCodeSuffix(["bc_e2etest"]).slice(2).toLowerCase();
const TOOL_A = `/herramientas/aprobaciones?address=${A}`;
const ALIAS = `p6a_${Date.now().toString(36)}`;

const rpcUrl = CHAINS[BASE].rpcUrl;
const localChain = { id: BASE, name: "Local Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: privateKeyToAccount(ownerA.privateKey), chain: localChain, transport: http(rpcUrl) });

async function approveFromSpec(amount: bigint) {
  const hash = await walletClient.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [SPENDER, amount] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}
const allowance = () => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [A, SPENDER] });
const balanceOf = (who: `0x${string}`) => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const setLogs = async (state: "fail" | "ok") => {
  const res = await fetch(`${MOCK_CHECKER_BASE}/__logs/${state}`, { method: "POST" });
  expect(res.ok).toBe(true);
};
async function expectSuffix(hash: string) {
  const tx = await publicClient.getTransaction({ hash: hash as Hex });
  expect(tx.input.toLowerCase().endsWith(SUFFIX)).toBe(true);
  return tx;
}

const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}
async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Connects the injected wallet from a «Conectar wallet» button in the page's main content (no SIWE). */
async function connectFromMain(page: Page) {
  const connect = page.getByRole("main").getByRole("button", { name: "Conectar wallet" });
  const metamask = page.locator("w3m-modal").getByText("MetaMask").first();
  await expect(async () => {
    if (!(await metamask.isVisible()) && (await connect.isVisible())) await connect.click({ timeout: 5_000 });
    await metamask.click({ timeout: 5_000 });
    await expect(connect).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

const approvalRow = (page: Page) => page.getByRole("region", { name: "Permisos activos" }).getByRole("listitem").filter({ hasText: SPENDER });
const listBox = (page: Page) => page.getByRole("textbox", { name: "Destinatarios" });
const progressList = (page: Page) => page.getByRole("list", { name: "Progreso" });

let anonCtx: BrowserContext;
let aCtx: BrowserContext;
let aPage: Page;
let walletA: TestWallet;
let cspA: () => Promise<string[]>;
let onSent: ((n: number, hash: string) => Promise<void>) | null = null;
let rejectNext = false;
let aliasUser: string | null = null;

test.beforeAll(async ({ browser }) => {
  // Clean slate even on a node kept between runs: no allowance from A to SPENDER.
  if ((await allowance()) !== 0n) await approveFromSpec(0n);
  await setLogs("ok");
  anonCtx = await browser.newContext({ viewport: desktop });
  trackErrors(anonCtx);
  aCtx = await browser.newContext({ viewport: desktop });
  trackErrors(aCtx);
  walletA = await installTestWallet(aCtx, {
    address: A,
    onSent: async (n, hash) => onSent?.(n, hash),
    reject: () => {
      if (!rejectNext) return false;
      rejectNext = false;
      return true;
    },
  });
  aPage = await aCtx.newPage();
  cspA = await watchCsp(aPage);
});

test.afterEach(async () => {
  // Review Focus 1 turns Blockscout's getLogs off; never leave it off for the next spec.
  await setLogs("ok");
  // A test that fails mid-way must not leave the wallet hooks armed: a stale rejectNext would fail a later signature.
  rejectNext = false;
  onSent = null;
});

test.afterAll(async () => {
  if ((await allowance()) !== 0n) await approveFromSpec(0n);
  if (aliasUser) await service().auth.admin.deleteUser(aliasUser);
  for (const c of [anonCtx, aCtx]) await c?.close();
});

test("1. anonymous: A's unlimited approval to a plain account, «Retirar» disabled and asking to connect", async () => {
  await approveFromSpec(maxUint256);
  const page = await anonCtx.newPage();
  const csp = await watchCsp(page);
  await page.goto(TOOL_A);
  await expect(page.getByRole("heading", { level: 1, name: "Aprobaciones" })).toBeVisible();
  await expect(page.getByText("Retirar un permiso es una transacción: cuesta gas.")).toBeVisible();
  const row = approvalRow(page);
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.getByText("Ilimitada")).toBeVisible();
  await expect(row.getByText("Cuenta normal (no es un contrato)")).toBeVisible();
  await expect(row.getByRole("button", { name: "Retirar" })).toBeDisabled();
  await expect(page.getByText(/Conecta la wallet 0x7099…79C8 para retirar permisos\./)).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Conectar wallet" })).toBeVisible();
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  expect(await csp()).toEqual([]);
  await page.close();
});

test("2. A connects (no SIWE) and revokes: Builder Code suffix, «Permiso retirado», gone after a reload, allowance 0", async () => {
  const page = aPage;
  await page.goto(TOOL_A);
  await expect(approvalRow(page)).toHaveCount(1, { timeout: 30_000 });
  await connectFromMain(page);
  const revoke = approvalRow(page).getByRole("button", { name: "Retirar" });
  await expect(revoke).toBeEnabled();
  const before = walletA.sent.length;
  await revoke.click();
  await expect(page.getByText("Permiso retirado.")).toBeVisible({ timeout: 60_000 });
  await expect(approvalRow(page)).toHaveCount(0);
  expect(walletA.sent).toHaveLength(before + 1);
  const tx = await expectSuffix(walletA.sent[before]!);
  expect(tx.to?.toLowerCase()).toBe(USDC.toLowerCase());
  expect(await allowance()).toBe(0n);
  await page.reload();
  await expect(page.getByRole("region", { name: "Permisos activos" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Buscando permisos…")).toHaveCount(0, { timeout: 30_000 });
  await expect(approvalRow(page)).toHaveCount(0);
});

test("3. Review Focus 1: getLogs down → «No se pudo obtener la lista completa…» and the manual check finds 5 USDC", async () => {
  await approveFromSpec(parseUnits("5", 6));
  await setLogs("fail");
  const page = aPage;
  await page.goto(TOOL_A);
  await expect(page.getByText("No se pudo obtener la lista completa; pega un token y un spender para comprobarlo.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Esta dirección no tiene permisos activos/)).toHaveCount(0);
  const manual = page.getByRole("region", { name: "Comprobar un permiso a mano" });
  await manual.getByLabel("Dirección del token").fill(USDC);
  await manual.getByLabel("Dirección del spender").fill(SPENDER);
  await manual.getByRole("button", { name: "Comprobar" }).click();
  const row = approvalRow(page);
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.getByRole("link", { name: "USDC en el explorador" })).toBeVisible();
  await expect(row.getByText("5", { exact: true })).toBeVisible();
  await setLogs("ok");
  await approveFromSpec(0n);
});

test("4. multisend: 10 + 20 + 0,5 USDC one by one; a #envio= during the run changes neither the list nor what is signed", async () => {
  const page = aPage;
  const lines = `${R5},10\n${R6},20\n${R7},0,5`;
  const before = await Promise.all([balanceOf(R5), balanceOf(R6), balanceOf(R7)]);
  await page.goto("/herramientas/envio-multiple");
  await expect(page.getByRole("heading", { level: 1, name: "Envío múltiple" })).toBeVisible();
  await listBox(page).fill(lines);
  await expect(page.getByRole("region", { name: "Resumen" }).getByText("30,5 USDC")).toBeVisible();
  // The e2e wallet does not answer wallet_getCapabilities (no EIP-5792): one signature per line.
  await expect(page.getByText("Tu wallet pedirá una firma por destinatario.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Enviar" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Vas a enviar 30,5 USDC a 3 direcciones en Base Sepolia. Cada envío es definitivo.")).toBeVisible();

  // Held right after the 1st transfer is mined: a «Repartir gastos»-style #envio= arrives mid-run.
  const intruder = `${hardhatAccount(8).address},99`;
  const sentStart = walletA.sent.length;
  let duringRun: string | null = null;
  onSent = async (n) => {
    if (n !== sentStart + 1) return;
    await page.evaluate((h) => {
      window.location.hash = h;
    }, encodeLines(intruder));
    await page.waitForTimeout(300);
    duringRun = await listBox(page).inputValue();
  };
  await dialog.getByRole("button", { name: "Confirmar y firmar" }).click();
  await expect(page.getByText("Todo enviado y confirmado.")).toBeVisible({ timeout: 90_000 });
  onSent = null;
  expect(duringRun).toBe(lines);
  await expect(listBox(page)).toHaveValue(lines);

  const sent = walletA.sent.slice(sentStart);
  expect(sent).toHaveLength(3);
  const signed = [];
  for (const hash of sent) {
    const tx = await expectSuffix(hash);
    expect(tx.to?.toLowerCase()).toBe(USDC.toLowerCase());
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    expect(functionName).toBe("transfer");
    signed.push(`${(args[0] as string).toLowerCase()}:${args[1] as bigint}`);
  }
  // Exactly the list on screen when «Confirmar y firmar» was pressed, never the #envio= that came mid-run.
  expect(signed).toEqual([`${R5.toLowerCase()}:10000000`, `${R6.toLowerCase()}:20000000`, `${R7.toLowerCase()}:500000`]);
  for (const n of [1, 2, 3]) await expect(progressList(page).getByRole("link", { name: `Ver la transacción de la línea ${n}` })).toBeVisible();
  const after = await Promise.all([balanceOf(R5), balanceOf(R6), balanceOf(R7)]);
  expect(after[0] - before[0]).toBe(parseUnits("10", 6));
  expect(after[1] - before[1]).toBe(parseUnits("20", 6));
  expect(after[2] - before[2]).toBe(parseUnits("0.5", 6));
});

test("5. Review Focus 4: the 2nd signature is rejected; after a reload «Continuar» sends only that line, the 1st is paid once", async () => {
  const page = aPage;
  const lines = `${R5},1\n${R6},2`;
  const before = await Promise.all([balanceOf(R5), balanceOf(R6)]);
  await page.goto("/herramientas/envio-multiple");
  await listBox(page).fill(lines);
  await expect(page.getByText("Tu wallet pedirá una firma por destinatario.")).toBeVisible({ timeout: 30_000 });
  const sentStart = walletA.sent.length;
  onSent = async (n) => {
    if (n === sentStart + 1) rejectNext = true;
  };
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar y firmar" }).click();
  await expect(page.getByText("Firma cancelada: esa línea no se ha enviado.")).toBeVisible({ timeout: 60_000 });
  onSent = null;
  expect(walletA.sent.length - sentStart).toBe(1);

  await page.reload();
  await listBox(page).fill(lines);
  await expect(progressList(page).getByRole("listitem").first()).toContainText("Confirmado", { timeout: 30_000 });
  await expect(progressList(page).getByRole("listitem").nth(1)).toContainText("Pendiente");
  const resume = page.getByRole("button", { name: "Continuar" });
  await expect(resume).toBeEnabled({ timeout: 30_000 });
  await resume.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Vas a enviar 2 USDC a 1 dirección en Base Sepolia. Cada envío es definitivo.")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar y firmar" }).click();
  await expect(page.getByText("Todo enviado y confirmado.")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent.length - sentStart).toBe(2);
  const after = await Promise.all([balanceOf(R5), balanceOf(R6)]);
  expect(after[0] - before[0]).toBe(parseUnits("1", 6));
  expect(after[1] - before[1]).toBe(parseUnits("2", 6));
});

test("6. Repartir gastos: A 30, B 0, C 0 → B and C pay 10 USDC to A, with a Pay link (amount=10); the copied link restores it", async () => {
  // A (the creditor) has a seeded ElClub Pay alias: the Pay link goes to it.
  const { data: user, error: userError } = await service().auth.admin.createUser({ email: `${ALIAS}@e2e.invalid`, email_confirm: true });
  expect(userError).toBeNull();
  aliasUser = user.user!.id;
  const { error } = await service().from("public_profiles").insert({ user_id: aliasUser, alias: ALIAS, wallet_address: A.toLowerCase() });
  expect(error).toBeNull();

  await aCtx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = aPage;
  await page.goto("/herramientas/envio-multiple#repartir");
  const split = page.getByRole("region", { name: "Repartir gastos" });
  await expect(split).toBeVisible();
  await split.getByRole("button", { name: "Añadir persona" }).click();
  const people = split.getByRole("group");
  const fillPerson = async (i: number, name: string, paid: string, target = "") => {
    const p = people.nth(i);
    await p.getByLabel("Nombre").fill(name);
    await p.getByLabel("Pagó (USDC)").fill(paid);
    if (target) await p.getByLabel("Dirección o alias (opcional)").fill(target);
  };
  await fillPerson(0, "Ana", "30", `@${ALIAS}`);
  await fillPerson(1, "Bea", "0");
  await fillPerson(2, "Carlos", "0");
  await expect(split.getByText("Carlos paga 10 USDC a Ana")).toBeVisible();
  await expect(split.getByText("Bea paga 10 USDC a Ana")).toBeVisible();
  const pay = split.getByRole("link", { name: "Pagar 10 USDC a Ana con ElClub Pay" }).first();
  const href = new URL((await pay.getAttribute("href"))!);
  expect(href.pathname).toBe(`/pay/${ALIAS}`);
  expect(href.searchParams.get("amount")).toBe("10");

  await split.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(split.getByText("Enlace copiado.")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("#gastos=");
  const other = await aCtx.newPage();
  await other.goto(link);
  const restored = other.getByRole("region", { name: "Repartir gastos" });
  await expect(restored.getByText("Carlos paga 10 USDC a Ana")).toBeVisible();
  await expect(restored.getByText("Bea paga 10 USDC a Ana")).toBeVisible();
  await other.close();
});

test("7. gas: both test networks in gwei, ETH and USD with the L1 part, the Ethereum reference and the converter", async () => {
  const page = await anonCtx.newPage();
  const csp = await watchCsp(page);
  await page.goto("/herramientas/gas");
  await expect(page.getByRole("heading", { level: 1, name: "Calculadora de gas" })).toBeVisible();
  await expect(page.getByText("Estimaciones aproximadas; el coste real depende de la transacción.")).toBeVisible();
  for (const name of ["Base Sepolia", "Arbitrum Sepolia"]) {
    const section = page.getByRole("region", { name });
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section.getByText(/Precio del gas: .* gwei/)).toBeVisible();
    const table = section.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Coste aprox. en USD" })).toBeVisible();
    const eth = table.getByRole("row", { name: /Enviar ETH/ }).getByRole("cell");
    await expect(eth).toHaveCount(3);
    for (const i of [0, 1, 2]) await expect(eth.nth(i)).not.toHaveText("—");
    // The test oracles answer (P6-R5b): no row lacks the L1 part.
    await expect(section.getByText("sin la parte de L1")).toHaveCount(0);
    await expect(section.getByText(/No se pudo leer la parte de L1/)).toHaveCount(0);
  }
  await expect(page.getByText("Sin precio de ETH ahora mismo: no se muestran importes en USD.")).toHaveCount(0);
  const ethereum = page.getByRole("region", { name: "Ethereum (solo tarifa base, referencia)" });
  await expect(ethereum.getByText(/Tarifa base de Ethereum según el oráculo de Base: 2 gwei/)).toBeVisible();
  await page.getByLabel("Cantidad en gwei").fill("1");
  await expect(page.getByLabel("Cantidad en ETH")).toHaveValue("0,000000001");
  await expect(page.getByText("Precio usado: 2000,00 USD por ETH (Chainlink).")).toBeVisible();
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  expect(await csp()).toEqual([]);
  await page.close();
});

test("8. ES/EN keeps each page (approvals with its query), no console errors, no CSP violations", async () => {
  const page = await anonCtx.newPage();
  const csp = await watchCsp(page);
  for (const [es, en, h1] of [
    [`${TOOL_A}&chain=base`, `/en/tools/approvals?address=${A}&chain=base`, "Approvals"],
    ["/herramientas/envio-multiple", "/en/tools/multisend", "Multisend"],
    ["/herramientas/gas", "/en/tools/gas", "Gas calculator"],
  ] as const) {
    await page.goto(es);
    await page.locator('a[hreflang="en"]').first().click();
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === en);
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    await page.locator('a[hreflang="es"]').first().click();
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === es);
  }
  await page.goto("/herramientas");
  for (const name of [/Aprobaciones/, /Envío múltiple/, /Calculadora de gas/]) await expect(page.getByRole("link", { name })).toContainText("Disponible");
  expect(await csp()).toEqual([]);
  expect(await cspA()).toEqual([]);
  expect(browserErrors).toEqual([]);
  await page.close();
});
