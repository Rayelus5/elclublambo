import { createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAIN_ID, hardhatAccount, RPC_URL, USDC_ADDRESS } from "./chain/shared.mjs";
import { addressOf, E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { createInvite, joinAs, openChannel, service, type Actor } from "./helpers/f2c";
import { connectInjected, installTestWallet, type TestWallet } from "./helpers/wallet";

// F3d acceptance: DAO treasury, DAO gating and reconciliation, on the F3b local Hardhat chain (e2e/chain/start-chain.mjs,
// started by playwright.config.ts). The Hardhat node answers the `finalized` tag with its latest block, so a donation
// is credited right away by the immediate settle in confirmIntent (ruling F3-R4): the pending-finality path (UI list,
// cron credit) is covered by unit tests (confirm, settle, cron route), not here. TEST-ONLY keys (Hardhat's public mnemonic). Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const adminAccount = hardhatAccount(1); // == E2E_SUPER_ADMIN_PK
const memberB = hardhatAccount(2); // B: watches the ranking
const memberA = hardhatAccount(3); // A: donor, session wallet and signer
const stranger = hardhatAccount(4); // sends USDC straight to the Safe, outside the app
// The Linea Sepolia Safe: a fresh, unfunded address (every Hardhat account is pre-minted 1M mock USDC, which reconciliation
// would rightly report as an unledgered balance). It only receives, so no key is ever used.
const safe = { address: privateKeyToAccount(generatePrivateKey()).address };
const platform = hardhatAccount(9); // receives the fee

const NAMES = { a: "Donante A", b: "Observador B" };
const VIP = "VIP DAO";
const SEEDED = "Mensaje reservado para socios de la DAO";
const CRON_SECRET = "e2e-cron-secret";
const SEPOLIA = "Linea Sepolia";

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
let vipId = "";
let handleA = "";

const chain = { id: CHAIN_ID, name: "Local Linea Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } };

/** ERC-20 balance of the local USDC for an address. */
async function usdcOf(address: string): Promise<bigint> {
  const client = createPublicClient({ chain, transport: http(RPC_URL) });
  return client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
}

/** Sends USDC from a Hardhat account (unlocked on the node) straight to `to`, bypassing the app entirely. */
async function sendUsdc(from: string, to: string, units: bigint) {
  const wallet = createWalletClient({ account: from as `0x${string}`, chain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, units] });
  const receipt = await createPublicClient({ chain, transport: http(RPC_URL) }).waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}

/** Settlement + reconciliation, as the scheduler would call it. */
async function runCron(method: "POST" | "GET" = "POST") {
  const res = await fetch("http://localhost:3000/api/cron/dao", { method, headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as { chains: Array<{ chainId: number; credited?: number; diff?: string; skipped?: string; error?: string }> };
}

const channelsNav = (page: Page) => page.getByRole("navigation", { name: "Canales" });
const lockedLink = (page: Page) => channelsNav(page).getByRole("link", { name: `${VIP}, bloqueado`, exact: true });

async function mismatchNotices(): Promise<number> {
  const { data, error } = await service().from("notifications").select("id").eq("kind", "treasury_mismatch").eq("recipient_id", admin.id);
  expect(error).toBeNull();
  return data?.length ?? 0;
}

test.beforeAll(async ({ browser }) => {
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
  for (const x of [a, b]) await x.page.setViewportSize(desktop);
  // joinAs already opened a page in A's context; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: memberA.address });
  a.page = await a.context.newPage();
  await a.page.setViewportSize(desktop);

  const handle = await service().from("members").select("handle").eq("id", a.id).single<{ handle: string | null }>();
  expect(handle.error).toBeNull();
  handleA = handle.data!.handle ?? "";
  expect(handleA).not.toBe("");
});

test.afterAll(async () => {
  for (const x of [admin, a, b]) await x?.context.close();
});

test("1. setup: the admin sets the Safe and the platform wallet, creates VIP DAO and gates it with 1 % or 5 USDC (view)", async () => {
  const p = admin.page;
  await p.goto("/settings/economia");
  await expect(p.getByRole("heading", { level: 2, name: "Economía" })).toBeVisible();
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Comisión mínima (%)").fill("2,6");
  await p.getByRole("button", { name: "Guardar comisión" }).click();
  await expect(p.getByText("Comisión guardada.")).toBeVisible();
  await p.getByLabel(`Safe (${SEPOLIA})`, { exact: true }).fill(safe.address);
  await p.getByLabel(`Wallet de la plataforma (${SEPOLIA})`, { exact: true }).fill(platform.address);
  await p.getByRole("button", { name: `Guardar direcciones de ${SEPOLIA}` }).click();
  await expect(p.getByText("Direcciones guardadas.")).toBeVisible();

  await p.goto("/settings/channels");
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Nuevo en Comunidad" }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByLabel("Tipo").selectOption("text");
  await dialog.getByLabel("Nombre").fill(VIP);
  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(dialog).toBeHidden();

  await p.getByRole("button", { name: `Editar ${VIP}` }).click();
  await p.getByLabel("% mínimo de la DAO").fill("1");
  await p.getByLabel("Aportación neta mínima (USDC)").fill("5");
  await p.getByRole("radio", { name: "Ver el canal" }).click();
  await p.getByRole("button", { name: "Guardar candado" }).click();
  await expect(p.getByText("Candado guardado")).toBeVisible();

  const ch = await service().from("channels").select("id, gate_min_share_bps, gate_min_net_usdc, gate_scope").eq("name", VIP).single<{
    id: string;
    gate_min_share_bps: number;
    gate_min_net_usdc: string;
    gate_scope: string;
  }>();
  expect(ch.error).toBeNull();
  expect(ch.data).toMatchObject({ gate_min_share_bps: 100, gate_scope: "view" });
  expect(BigInt(ch.data!.gate_min_net_usdc)).toBe(5_000_000n);
  vipId = ch.data!.id;

  // A message only members who pass the gate may read.
  const seeded = await service()
    .from("messages")
    .insert({
      channel_id: vipId,
      author_id: admin.id,
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: SEEDED }] }] },
      body_text: SEEDED,
      allow_links: false,
    });
  expect(seeded.error).toBeNull();
});

test("2. locked: A sees VIP DAO locked in the sidebar and the lock page shows requirement and situation, without the messages", async () => {
  await a.page.goto("/");
  await expect(lockedLink(a.page)).toBeVisible();
  await lockedLink(a.page).click();
  await expect(a.page).toHaveURL(new RegExp(`/c/${vipId}$`));
  await expect(a.page.getByRole("heading", { level: 1, name: VIP })).toBeVisible();
  await expect(a.page.getByText("Necesitas 1 % de la DAO o 5 USDC aportados")).toBeVisible();
  await expect(a.page.getByText(`Tu situación: 0 % · 0 USDC aportados en ${SEPOLIA}`)).toBeVisible();
  await expect(a.page.getByRole("button", { name: "Donar a la DAO" })).toBeVisible();
  await expect(a.page.getByText(SEEDED)).toHaveCount(0);
  await expect(a.page.getByRole("log", { name: "Mensajes del canal" })).toHaveCount(0);
});

test("3. donate 10 USDC: two signatures, credited at once (Hardhat finalized = latest), 100 % and balance 10 USDC", async () => {
  const safeBefore = await usdcOf(safe.address);
  const platformBefore = await usdcOf(platform.address);

  await a.page.goto(`/c/${vipId}`);
  await a.page.getByRole("button", { name: "Donar a la DAO" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Donar a la DAO" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await connectInjected(a.page, "Donar a la DAO");
  await dialog.getByLabel("Importe").fill("10");
  await expect(dialog.getByTestId("tip-total")).toHaveText("10,26 USDC");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Donación acreditada.")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(2); // fee + donation
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click(); // not the X (data-slot="dialog-close")

  expect((await usdcOf(safe.address)) - safeBefore).toBe(10_000_000n);
  expect((await usdcOf(platform.address)) - platformBefore).toBe(260_000n);

  // Already credited: Hardhat's `finalized` block is its latest, so nothing is left pending.
  await a.page.goto("/dao");
  await expect(a.page.getByTestId("dao-balance")).toHaveText("10 USDC");
  await expect(a.page.getByTestId("my-share")).toHaveText("100 %");
  await expect(a.page.getByTestId("my-net")).toHaveText("10 USDC");
  await expect(a.page.getByRole("list", { name: "Donaciones pendientes" })).toHaveCount(0);

  // The cron finds nothing left to credit and the Safe balance matches the ledger.
  const report = await runCron("POST");
  const sepolia = report.chains.find((c) => c.chainId === CHAIN_ID);
  expect(sepolia?.error).toBeUndefined();
  expect(sepolia?.credited).toBe(0);
  expect(sepolia?.diff).toBe("0");

  // B sees the treasury, and the donor as Anónimo (privacy default).
  await b.page.goto("/dao");
  await expect(b.page.getByTestId("dao-balance")).toHaveText("10 USDC");
  const ranking = b.page.getByRole("table", { name: "Ranking de la DAO" });
  await expect(ranking.getByRole("row", { name: /Anónimo/ })).toBeVisible();
  await expect(ranking.getByRole("row", { name: /100 %/ })).toBeVisible();
  await expect(b.page.getByText(handleA)).toHaveCount(0);
});

test("4. ranking toggle: A opts in and B sees A's handle", async () => {
  await a.page.goto("/dao");
  const toggle = a.page.getByLabel("Aparecer con mi nombre en el ranking de la DAO");
  await expect(toggle).toBeVisible();
  await a.page.waitForLoadState("networkidle");
  await toggle.click();
  await expect(toggle).toBeChecked();

  await expect
    .poll(
      async () => {
        await b.page.goto("/dao");
        // The ranking streams in after load: count() does not wait, so wait for the table first.
        const table = b.page.getByRole("table", { name: "Ranking de la DAO" });
        await expect(table).toBeVisible();
        return table.getByText(handleA).count();
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBeGreaterThan(0);
});

test("5. unlocked: A opens VIP DAO and reads the seeded message", async () => {
  await a.page.goto("/");
  await expect(lockedLink(a.page)).toHaveCount(0);
  await openChannel(a.page, VIP);
  await expect(a.page.getByText(SEEDED)).toBeVisible();
  await expect(a.page.getByText("Canal con candado")).toHaveCount(0);
});

test("6. direct transfer: 3 USDC straight to the Safe show as a positive diff and alert the admin, but never enter the ledger", async () => {
  expect(await mismatchNotices()).toBe(0);
  const safeBefore = await usdcOf(safe.address);
  await sendUsdc(stranger.address, safe.address, 3_000_000n);
  expect((await usdcOf(safe.address)) - safeBefore).toBe(3_000_000n);

  const p = admin.page;
  await p.goto("/dao");
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Reconciliar ahora" }).click();
  await expect(p.getByText("Hay fondos en la Safe que no están en el registro (transferencias directas)")).toBeVisible({ timeout: 30_000 });
  await expect(p.getByRole("region", { name: "Reconciliación" })).toContainText("+3 USDC");

  // The admin's notification list carries the alert, sent once.
  await p.goto("/notifications");
  await expect(p.getByText("El saldo de la Safe no coincide con el registro de la DAO").first()).toBeVisible();
  expect(await mismatchNotices()).toBe(1);

  // Deduplicated: the cron sees the same effective diff and does not notify again.
  const report = await runCron("GET");
  expect(report.chains.find((c) => c.chainId === CHAIN_ID)?.diff).toBe("3000000");
  expect(await mismatchNotices()).toBe(1);

  // Review focus 1: the direct transfer minted no shares and moved no value.
  await a.page.goto("/dao");
  await expect(a.page.getByTestId("dao-balance")).toHaveText("10 USDC");
  await expect(a.page.getByTestId("my-share")).toHaveText("100 %");
  await expect(a.page.getByTestId("dao-donors")).toHaveText("1");
});

test("7. network switch: on Linea the ledger is empty (VIP DAO locks again, /dao shows 0); switching back restores both", async () => {
  const p = admin.page;
  const switchTo = async (current: string, target: string) => {
    await p.goto("/settings/economia");
    await p.waitForLoadState("networkidle");
    await p.getByRole("button", { name: `Cambiar a ${target}` }).click();
    await p.getByRole("alertdialog").getByRole("button", { name: "Continuar" }).click();
    await expect(p.getByRole("button", { name: `Cambiar a ${current}` })).toBeVisible({ timeout: 30_000 });
  };

  await switchTo(SEPOLIA, "Linea");
  try {
    await a.page.goto("/");
    await expect(lockedLink(a.page)).toBeVisible();
    await a.page.goto(`/c/${vipId}`);
    await expect(a.page.getByText("Necesitas 1 % de la DAO o 5 USDC aportados")).toBeVisible();
    await expect(a.page.getByText("Tu situación: 0 % · 0 USDC aportados en Linea", { exact: false })).toBeVisible();
    await expect(a.page.getByText(SEEDED)).toHaveCount(0);
    await a.page.goto("/dao");
    await expect(a.page.getByTestId("dao-balance")).toHaveText("0 USDC");
    await expect(a.page.getByTestId("my-share")).toHaveText("0 %");
  } finally {
    await switchTo("Linea", SEPOLIA);
  }

  await a.page.goto("/dao");
  await expect(a.page.getByTestId("dao-balance")).toHaveText("10 USDC");
  await expect(a.page.getByTestId("my-share")).toHaveText("100 %");
  await a.page.goto(`/c/${vipId}`);
  await expect(a.page.getByText(SEEDED)).toBeVisible();
  await expect(lockedLink(a.page)).toHaveCount(0);
});

test("8. no browser errors in any context", () => {
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  expect(browserErrors.filter((e) => !coopOn404(e))).toEqual([]);
});
