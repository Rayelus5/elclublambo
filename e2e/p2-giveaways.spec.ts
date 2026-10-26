import { createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAINS, hardhatAccount } from "./chain/shared.mjs";
import { addressOf, loginAs, newWalletKey } from "./helpers/auth";
import { service } from "./helpers/f2c";
import { installTestWallet, signInPublic } from "./helpers/wallet";

// P2 acceptance of the public giveaways (/herramientas/sorteos, /en/tools/giveaways). A (host, no membership) signs in
// through the public connect on the create page with an injected wallet bound to a Hardhat account (TEST-ONLY keys,
// Hardhat's public mnemonic; account 8 holds mock USDC) and creates a giveaway with a USDC prize on Base Sepolia and
// «Camiseta». B opens the link without a session, signs in from «Participa» and comes back with ?join=1 (Review Focus 2).
// C (a generated key, cookie login) joins in English. The close is moved into the past with the service client; opening
// the page draws it (P2-R11) against the local drand (e2e/mock/drand.mjs). The host pays the USDC prize from its own
// wallet on the local node and pastes the hash («Ya lo pagué»). Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const desktop = { width: 1280, height: 900 };
const phone = { width: 375, height: 812 };
const STAMP = Date.now().toString(36);
const TITLE = `Sorteo público ${STAMP}`;
const DRAND_GENESIS = 1692803367;
const host = hardhatAccount(8);
const entrantB = hardhatAccount(9);
const keyC = newWalletKey();

const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

/** Moves the close 30 s into the past with its drand round (the first round after it, as create fixed it). */
async function ageGiveaway(id: string) {
  const close = Date.now() - 30_000;
  const round = Math.floor((close / 1000 - DRAND_GENESIS) / 3) + 2;
  const { data, error } = await service()
    .from("public_giveaways")
    .update({ closes_at: new Date(close).toISOString(), target_round: round })
    .eq("id", id)
    .select("id");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
}

type PrizeRow = { rank: number; kind: string; status: string; winner_address: string | null; amount: string | null };
async function prizesOf(id: string): Promise<PrizeRow[]> {
  const { data, error } = await service()
    .from("public_giveaway_prizes")
    .select("rank, kind, status, winner_address, amount:amount::text")
    .eq("giveaway_id", id)
    .order("rank");
  expect(error).toBeNull();
  return (data ?? []) as PrizeRow[];
}

function localIn(ms: number): string {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const rpcUrl = CHAINS[BASE].rpcUrl;
const localChain = { id: BASE, name: "Local Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });

let hostCtx: BrowserContext;
let hostPage: Page;
let bCtx: BrowserContext;
let cCtx: BrowserContext;
let giveawayId = "";
const esPath = () => `/herramientas/sorteos/${giveawayId}`;

test.beforeAll(async ({ browser }) => {
  hostCtx = await browser.newContext({ viewport: desktop });
  trackErrors(hostCtx);
  await installTestWallet(hostCtx, { address: host.address });
  hostPage = await hostCtx.newPage();
  bCtx = await browser.newContext({ viewport: desktop });
  trackErrors(bCtx);
  await installTestWallet(bCtx, { address: entrantB.address });
  cCtx = await browser.newContext({ viewport: desktop });
  trackErrors(cCtx);
});

test.afterAll(async () => {
  for (const c of [hostCtx, bCtx, cCtx]) await c?.close();
});

const prizeList = (page: Page, name = "Premios del sorteo") => page.getByRole("list", { name });

test("1. a wallet without invitation signs in on the create page and creates a giveaway (USDC + «Camiseta»)", async () => {
  const page = hostPage;
  await page.goto("/herramientas/sorteos/nuevo");
  await expect(page.getByRole("heading", { level: 1, name: "Crear sorteo" })).toBeVisible();
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);

  await signInPublic(page, page.getByRole("main"));
  await expect(page.getByLabel("Título")).toBeVisible();
  await expect(new URL(page.url()).pathname).toBe("/herramientas/sorteos/nuevo");

  await page.getByLabel("Título").fill(TITLE);
  // Two hours ahead (the close is moved into the past later): a local time within an hour of a DST change back is
  // ambiguous and the browser reads it an hour earlier, so a 12-minute close would fail on that night.
  await page.getByLabel("Cierre").fill(localIn(2 * 3600_000));
  const first = page.getByRole("group", { name: "Premio 1" });
  await first.getByRole("radio", { name: /Base Sepolia/ }).click();
  await first.getByLabel("Importe en USDC").fill("5");
  await page.getByRole("button", { name: "Añadir premio" }).click();
  const second = page.getByRole("group", { name: "Premio 2" });
  await second.getByRole("radio", { name: "Otro" }).click();
  await second.getByRole("textbox", { name: "Premio", exact: true }).fill("Camiseta");

  // The filled form at phone width: no horizontal scroll either.
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);

  await page.getByRole("button", { name: "Crear sorteo" }).click();
  await page.waitForURL(/\/herramientas\/sorteos\/[0-9a-f-]{36}$/);
  giveawayId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Panel del organizador" })).toBeVisible();

  const prizes = await prizesOf(giveawayId);
  expect(prizes.map((p) => p.kind)).toEqual(["crypto", "custom"]);
  expect(prizes[0]!.amount).toBe("5000000");
  const g = await service().from("public_giveaways").select("host_address").eq("id", giveawayId).single<{ host_address: string }>();
  expect(g.data?.host_address).toBe(host.address.toLowerCase());
});

test("2. B opens the link without a session, signs in from «Participa» and joins with one click (Review Focus 2)", async () => {
  const page = await bCtx.newPage();
  await page.goto(esPath());
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);

  const join = page.getByRole("region", { name: "Participa" });
  await expect(join.getByText("Conecta tu wallet. Al volver, un clic y estás dentro.")).toBeVisible();
  await signInPublic(page, join);
  // Back on the same giveaway, ?join=1 kept through the Spanish rewrite, «Participar» focused: one key press joins.
  await page.waitForURL((u) => u.pathname === esPath() && u.searchParams.get("join") === "1");
  const enter = join.getByRole("button", { name: "Participar" });
  await expect(enter).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(join.getByText("Estás dentro")).toBeVisible();
  await expect(page.getByRole("list", { name: "Lista de participantes" }).getByRole("listitem")).toHaveCount(1);
});

test("3. C joins in English", async () => {
  await loginAs(cCtx, keyC);
  const page = await cCtx.newPage();
  await page.goto(`/en/tools/giveaways/${giveawayId}`);
  const join = page.getByRole("region", { name: "Take part" });
  await join.getByRole("button", { name: "Enter" }).click();
  await expect(join.getByText("You are in")).toBeVisible();
  const { data } = await service().from("public_giveaway_entries").select("wallet_address").eq("giveaway_id", giveawayId).order("entered_at");
  expect((data ?? []).map((e: { wallet_address: string }) => e.wallet_address)).toEqual([
    entrantB.address.toLowerCase(),
    addressOf(keyC),
  ]);
});

test("4. once due, opening the page draws it (P2-R11) and «Comprobar» gives three ✓", async () => {
  await ageGiveaway(giveawayId);
  const page = hostPage;
  await page.goto(esPath());
  await expect(page.getByText("Sorteado", { exact: true }).first()).toBeVisible();
  const prizes = await prizesOf(giveawayId);
  expect(prizes.map((p) => p.status)).toEqual(["awarded", "awarded"]);
  expect(new Set(prizes.map((p) => p.winner_address)).size).toBe(2);

  await page.getByRole("button", { name: "Comprobar" }).click();
  const result = page.getByRole("list", { name: "Resultado de la comprobación" });
  await expect(result.getByRole("img", { name: "Correcto" })).toHaveCount(3);
  await expect(result.getByRole("img", { name: "No coincide" })).toHaveCount(0);

  const entries = await page.request.get(`${esPath()}/entries`);
  expect(entries.status()).toBe(200);
  const json = (await entries.json()) as { entries: { position: number; address: string }[] };
  expect(json.entries.map((e) => e.position)).toEqual([1, 2]);
});

test("5. the host marks «Camiseta» delivered", async () => {
  const page = hostPage;
  await page.goto(esPath());
  const panel = page.getByRole("region", { name: "Panel del organizador" });
  await panel.getByRole("listitem").filter({ hasText: "Camiseta" }).getByRole("button", { name: "Marcar entregado" }).click();
  await expect(prizeList(page).getByRole("listitem").filter({ hasText: "Camiseta" })).toContainText("Entregado");
  expect((await prizesOf(giveawayId))[1]!.status).toBe("delivered");
});

test("6. the host pays the USDC prize from its wallet and pastes the hash: «Pagado»", async () => {
  const usdc = (await prizesOf(giveawayId))[0]!;
  const wallet = createWalletClient({ account: host.address as `0x${string}`, chain: localChain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({ address: CHAINS[BASE].usdc as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [usdc.winner_address as `0x${string}`, BigInt(usdc.amount!)] });
  expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
  await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });

  const page = hostPage;
  await page.goto(esPath());
  const item = page.getByRole("region", { name: "Panel del organizador" }).getByRole("listitem").filter({ hasText: "USDC" });
  await item.getByRole("button", { name: "Ya lo pagué" }).click();
  await item.getByLabel("Hash de la transacción").fill(hash);
  await item.getByRole("button", { name: "Comprobar pago" }).click();
  // «Pago verificado.» is transient: the refresh that follows drops the prize from the panel (nothing left to pay), so
  // the lasting proof is the public prize row.
  await expect(prizeList(page).getByRole("listitem").filter({ hasText: "USDC" })).toContainText("Pagado", { timeout: 30_000 });
  expect((await prizesOf(giveawayId))[0]!.status).toBe("paid");
});

test("7. the share card is a PNG for the giveaway and the generic card for an unknown id", async () => {
  const page = hostPage;
  await page.goto(esPath());
  const content = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  expect(content).toContain(giveawayId);
  // Absolute on the site's origin (metadataBase); fetched here from the local server by its path.
  const og = new URL(content!).pathname;
  const real = await page.request.get(og);
  expect(real.status()).toBe(200);
  expect(real.headers()["content-type"]).toContain("image/png");
  const unknown = await page.request.get(og.replace(giveawayId, "00000000-0000-4000-8000-000000000000"));
  expect(unknown.status()).toBe(200);
  expect(unknown.headers()["content-type"]).toContain("image/png");
});

test("8. the ES/EN switcher keeps the giveaway (Review Focus 5); 375 px without horizontal scroll", async () => {
  const page = hostPage;
  await page.goto(esPath());
  await page.getByRole("navigation", { name: "Idioma" }).first().getByRole("link", { name: "en" }).click();
  await page.waitForURL((u) => u.pathname === `/en/tools/giveaways/${giveawayId}`);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await page.getByRole("navigation", { name: "Language" }).first().getByRole("link", { name: "es" }).click();
  await page.waitForURL((u) => u.pathname === esPath());
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);
});

test("9. no console errors along the way", async () => {
  expect(browserErrors).toEqual([]);
});
