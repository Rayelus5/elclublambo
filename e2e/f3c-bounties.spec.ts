import { createPublicClient, erc20Abi, http } from "viem";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAIN_ID, hardhatAccount, RPC_URL, USDC_ADDRESS } from "./chain/shared.mjs";
import { E2E_SUPER_ADMIN_PK, loginAs } from "./helpers/auth";
import { composer, createInvite, joinAs, messageWith, openChannel, rpcAs, service, type Actor } from "./helpers/f2c";
import { installTestWallet, type TestWallet } from "./helpers/wallet";

// F3c acceptance, bounties, on the F3b local Hardhat chain (e2e/chain/start-chain.mjs, started by playwright.config.ts):
// the author signs with an injected EIP-1193 wallet bound to a Hardhat account and logs in with that same account's key.
// TEST-ONLY keys (Hardhat's public mnemonic). Scenarios share state (the same members and bounties): run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const author = hardhatAccount(3); // A: Verificado, session wallet and signer
const solverAccount = hardhatAccount(2); // B: replies, gets paid
const plain = hardhatAccount(5); // C: no CREATE_BOUNTIES
const platform = hardhatAccount(9); // receives the fee

const NAMES = { a: "Autora Bounty", b: "Solucionador B", c: "Miembro Raso C" };
const DAY_MS = 86_400_000;

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
let walletA: TestWallet;
let b: Actor;
let c: Actor;
let generalChannel = "";
const bountyIds: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: desktop });
  trackErrors(adminContext);
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };

  const invite = () => createInvite(admin.page);
  // A holds the Verificado role (it carries CREATE_BOUNTIES by default); B and C are plain members.
  a = await joinAs(browser, author.privateKey, await invite(), NAMES.a, "Verificado", trackErrors);
  b = await joinAs(browser, solverAccount.privateKey, await invite(), NAMES.b, undefined, trackErrors);
  c = await joinAs(browser, plain.privateKey, await invite(), NAMES.c, undefined, trackErrors);
  for (const x of [a, b, c]) await x.page.setViewportSize(desktop);
  // joinAs already opened a page in A's context; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: author.address });
  a.page = await a.context.newPage();
  await a.page.setViewportSize(desktop);

  const { data, error } = await service().from("channels").select("id").eq("name", "General").single<{ id: string }>();
  expect(error).toBeNull();
  generalChannel = data!.id;
});

test.afterAll(async () => {
  for (const x of [admin, a, b, c]) await x?.context.close();
});

const bountyCard = (page: Page, text: string) => messageWith(page, text);
const status = (page: Page, text: string) => bountyCard(page, text).getByTestId("bounty-status");
const threadPanel = (page: Page) => page.getByRole("complementary", { name: "Panel del hilo" });

/** The author publishes a bounty in General with /bounty. */
async function publishBounty(page: Page, description: string, amount: string): Promise<string> {
  await openChannel(page, "General");
  await composer(page).click();
  await composer(page).pressSequentially("/bounty");
  await page.getByRole("option", { name: /\/bounty/ }).click();
  const dialog = page.getByRole("dialog", { name: "Publicar bounty" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Recompensa").fill(amount);
  await dialog.getByLabel("Descripción").fill(description);
  await dialog.getByRole("button", { name: "Publicar bounty" }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page, description)).toHaveText("Abierto");
  const id = (await bountyCard(page, description).getAttribute("data-message-id"))!;
  expect(id).toBeTruthy();
  return id;
}

/** B answers in the bounty's thread (opened straight from the URL); returns the reply text for later lookups. */
async function reply(page: Page, bountyId: string, text: string) {
  await page.goto(`/c/${generalChannel}?thread=${bountyId}`);
  const panel = threadPanel(page);
  await expect(panel).toBeVisible();
  const box = panel.getByRole("textbox", { name: "Mensaje del hilo" });
  await box.click();
  await box.fill(text);
  await box.press("Enter");
  await expect(panel.getByText(text)).toBeVisible();
}

/** The author picks the reply as the solution. */
async function markSolution(page: Page, bountyId: string, replyText: string) {
  await page.goto(`/c/${generalChannel}?thread=${bountyId}`);
  const panel = threadPanel(page);
  const item = panel.locator("li[data-message-id]", { hasText: replyText }).first();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Marcar como solución" }).click();
  await page.getByRole("button", { name: "Sí, marcar como solución" }).click();
  await expect(item.getByText("Solución", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function connectWallet(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Pagar bounty" });
  await dialog.getByRole("button", { name: "Conectar wallet" }).click();
  await page.locator("w3m-modal").getByText("MetaMask").first().click();
}

/** Reconnects only if the page did not restore the previous connection by itself. */
async function connectIfNeeded(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Pagar bounty" });
  const connect = dialog.getByRole("button", { name: "Conectar wallet" });
  const ready = dialog.getByRole("button", { name: "Continuar" });
  await expect(connect.or(ready)).toBeVisible();
  await page.waitForTimeout(2_000);
  if (await connect.isVisible()) await connectWallet(page);
}

/** The author pays from the card; returns once the dialog says it is done. */
async function payFromCard(page: Page, description: string, total: string) {
  await bountyCard(page, description).getByRole("button", { name: "Pagar bounty" }).click();
  const dialog = page.getByRole("dialog", { name: "Pagar bounty" });
  await expect(dialog).toBeVisible();
  await connectIfNeeded(page);
  await expect(dialog.getByTestId("tip-total")).toHaveText(total);
  const before = walletA.sent.length;
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Bounty pagado")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent.length - before).toBe(2); // fee + payment
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
}

test("1. create: a Verificado member types /bounty, publishes 5 USDC and the card says Abierto", async () => {
  // Admin sets the 2.6 % fee and the platform wallet (same setup as F3b).
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

  await openChannel(b.page, "General");
  bountyIds.first = await publishBounty(a.page, "Bounty uno: falla el login", "5");
  await expect(a.page.getByText("5 USDC").first()).toBeVisible();
  // Another viewer sees it live.
  await expect(status(b.page, "Bounty uno: falla el login")).toHaveText("Abierto", { timeout: 30_000 });
  const row = await service().from("bounties").select("token, amount").eq("message_id", bountyIds.first!).single<{ token: string; amount: string }>();
  expect(row.data).toMatchObject({ token: "USDC", amount: "5000000" });
});

test("2. solve and pay: mark B's reply, B is notified, A signs twice, card Pagado, Recompensado badge and notice", async () => {
  const text = "Bounty uno: falla el login";
  const solution = "La causa es la cookie de sesión";
  await reply(b.page, bountyIds.first!, solution);

  // A has the channel open on the card: marking must reach the other viewer live.
  await openChannel(b.page, "General");
  await markSolution(a.page, bountyIds.first!, solution);
  await a.page.goto(`/c/${generalChannel}`);
  await expect(status(a.page, text)).toHaveText("Solución elegida · quedan 7 días para pagar");
  await expect(status(b.page, text)).toHaveText("Solución elegida · quedan 7 días para pagar", { timeout: 30_000 });

  // B's bell and notification list.
  await b.page.goto("/notifications");
  await expect(b.page.getByText(`${NAMES.a} ha elegido tu respuesta como solución del bounty`)).toBeVisible();

  const solverBefore = await usdcOf(solverAccount.address);
  const platformBefore = await usdcOf(platform.address);
  await a.page.goto(`/c/${generalChannel}`);
  await payFromCard(a.page, text, "5,13 USDC");
  expect(((await usdcOf(solverAccount.address)) - solverBefore).toString()).toBe("5000000");
  expect(((await usdcOf(platform.address)) - platformBefore).toString()).toBe("130000");

  await expect(status(a.page, text)).toHaveText("Pagado", { timeout: 30_000 });
  await expect(status(b.page, text)).toHaveText("Pagado", { timeout: 30_000 });

  // The solution carries the badge and the thread has the payment notice.
  await a.page.goto(`/c/${generalChannel}?thread=${bountyIds.first!}`);
  const panel = threadPanel(a.page);
  await expect(panel.locator("li[data-message-id]", { hasText: solution }).getByRole("button", { name: /Recompensado · 5 USDC/ })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/ha pagado el bounty: 5 USDC a /)).toBeVisible();

  // B hears about the payment.
  await b.page.goto("/notifications");
  await expect(b.page.getByText(`${NAMES.a} te ha pagado el bounty`)).toBeVisible();
});

test("3. unpaid then paid late: 8 days after marking the card and the author's profile say Impagado; paying makes it Pagado tarde", async () => {
  const text = "Bounty dos: no carga el feed";
  const solution = "Falta paginar la consulta";
  bountyIds.second = await publishBounty(a.page, text, "5");
  await reply(b.page, bountyIds.second, solution);
  await markSolution(a.page, bountyIds.second, solution);

  const backdate = await service()
    .from("bounties")
    .update({ solution_marked_at: new Date(Date.now() - 8 * DAY_MS).toISOString() })
    .eq("message_id", bountyIds.second);
  expect(backdate.error).toBeNull();

  await a.page.goto(`/c/${generalChannel}`);
  await expect(status(a.page, text)).toHaveText("Impagado");
  // Anyone who can see the channel sees the author's record.
  await c.page.goto(`/u/${author.address.toLowerCase()}`);
  await expect(c.page.getByRole("heading", { level: 2, name: "Bounties" })).toBeVisible();
  await expect(c.page.getByText("Bounties: 1 pagado · 0 pagados tarde · 1 impagado")).toBeVisible();
  await expect(c.page.getByRole("list", { name: "Bounties impagados" }).getByRole("link")).toHaveCount(1);

  await payFromCard(a.page, text, "5,13 USDC");
  await expect(status(a.page, text)).toHaveText("Pagado tarde", { timeout: 30_000 });
  await c.page.goto(`/u/${author.address.toLowerCase()}`);
  await expect(c.page.getByText("Bounties: 1 pagado · 1 pagado tarde · 0 impagados")).toBeVisible();
});

test("4. expired: 31 days without a solution the card says Expirado and no reply can be marked", async () => {
  const text = "Bounty tres: nadie responde";
  const answer = "Respuesta que llega tarde";
  bountyIds.third = await publishBounty(a.page, text, "5");
  await reply(b.page, bountyIds.third, answer);
  const backdate = await service()
    .from("bounties")
    .update({ created_at: new Date(Date.now() - 31 * DAY_MS).toISOString() })
    .eq("message_id", bountyIds.third);
  expect(backdate.error).toBeNull();

  await a.page.goto(`/c/${generalChannel}`);
  await expect(status(a.page, text)).toHaveText("Expirado");
  await a.page.goto(`/c/${generalChannel}?thread=${bountyIds.third}`);
  const panel = threadPanel(a.page);
  await expect(panel.getByText(answer)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Marcar como solución" })).toHaveCount(0);
  // The server refuses it too.
  const row = await service().from("messages").select("id").eq("thread_root_id", bountyIds.third).eq("body_text", answer).single<{ id: string }>();
  expect(row.error).toBeNull();
  const direct = await rpcAs(a.context, "mark_bounty_solution", { p_bounty: bountyIds.third, p_reply: row.data!.id });
  expect(direct.error?.message).toBe("bounty_closed");
});

test("5. no permission: a member without Crear bounties is not offered /bounty and create_bounty answers forbidden", async () => {
  await openChannel(c.page, "General");
  await composer(c.page).click();
  await composer(c.page).pressSequentially("/bou");
  await c.page.waitForTimeout(500);
  await expect(c.page.getByRole("option", { name: /\/bounty/ })).toHaveCount(0);
  await composer(c.page).fill("");

  const direct = await rpcAs(c.context, "create_bounty", {
    p_channel: generalChannel,
    p_body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "intento sin permiso" }] }] },
    p_token: "USDC",
    p_amount: "5000000",
  });
  expect(direct.error?.message).toBe("forbidden");
  const { count } = await service().from("bounties").select("*", { count: "exact", head: true }).eq("author_id", c.id);
  expect(count).toBe(0);
});

test("6. no browser errors in any context", () => {
  const coopOn404 = (e: string) => /^console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  expect(browserErrors.filter((e) => !coopOn404(e))).toEqual([]);
});

/** ERC-20 balance of the local USDC for an address. */
async function usdcOf(address: string): Promise<bigint> {
  const client = createPublicClient({
    chain: { id: CHAIN_ID, name: "Local Linea Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
    transport: http(RPC_URL),
  });
  return client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
}
