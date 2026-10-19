import { parseAbi, parseEther, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CHAIN_ID, hardhatAccount, WETH_ADDRESS } from "./chain/shared.mjs";
import { addressOf, E2E_SUPER_ADMIN_PK, handleOf, loginAs } from "./helpers/auth";
import {
  acknowledgeDonation,
  ageDraw,
  ageRaffle,
  ageSnapshots,
  mineBlock,
  noticesOf,
  operationsList,
  resetLocalDao,
  runCron,
  safeTransfer,
  sendCall,
  sendToken,
  tokenBalance,
} from "./helpers/dao";
import { createInvite, joinAs, service, type Actor } from "./helpers/f2c";
import { connectInjected, installTestWallet, type TestWallet } from "./helpers/wallet";

// F4d acceptance: verifiable raffles on the local Hardhat chain (e2e/chain/start-chain.mjs, mock USDC / WETH / ETH-USD
// feed at 2500 USD). A treasurer creates a raffle (the prize leaves the share value at once), members join, the cron
// closes it once closes_at is past and draws it with the first block after the close once that block is finalized
// (Hardhat: finalized = latest), and the browser verifier recomputes it against the same chain (playwright.config sets
// NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL to the local node). Close and unpaid are made deterministic by moving closes_at /
// drawn_at into the past (ageRaffle / ageDraw) and mining blocks: no wall-clock waits. TEST-ONLY keys (Hardhat's public
// mnemonic). Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
const adminAccount = hardhatAccount(1); // == E2E_SUPER_ADMIN_PK: SuperAdmin and treasurer (MANAGE_TREASURY)
const memberA = hardhatAccount(6); // A: donor (10 participaciones), shown by name
const memberB = hardhatAccount(7); // B: no participaciones, hidden in the ranking
const stranger = hardhatAccount(8); // tops the Safe up with WETH from outside the app
const platform = hardhatAccount(9); // receives the fee
// The Linea Sepolia Safe: a fresh, unfunded address, impersonated for its payouts (safeTransfer).
const safe = privateKeyToAccount(generatePrivateKey()).address;

const NAMES = { a: "Sorteo A", b: "Sorteo B" };
const LABEL_A = handleOf(memberA.privateKey);
const SEPOLIA = "Linea Sepolia";
const TITLES = { usdc: "Sorteo de prueba", weth: "Sorteo ponderado", cancel: "Sorteo cancelado", void: "Sorteo vacío" };
const CANCEL_REASON = "Prueba de cancelación";
const usdc = (n: string) => parseUnits(n, 6);
const wethAbi = parseAbi(["function deposit() payable"]);

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
const ids: Record<keyof typeof TITLES, string> = { usdc: "", weth: "", cancel: "", void: "" };
let winner: { id: string; address: string } = { id: "", address: "" };

/** "3,5 USD" -> 3.5 (display only). */
function parseUsd(text: string): number {
  const m = /([\d.]+(?:,\d+)?) USD/.exec(text);
  expect(m, text).not.toBeNull();
  return Number(m![1]!.replaceAll(".", "").replace(",", "."));
}

const sharePrice = async (page: Page) => {
  await page.goto("/dao");
  return parseUsd((await page.getByTestId("dao-share-price").textContent()) ?? "");
};
const card = (page: Page, title: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const panelSection = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
const panelRow = (page: Page, title: string): Locator => panelSection(page, "Sorteos").getByRole("listitem").filter({ hasText: title });

async function raffleRow(title: string): Promise<{ id: string; status: string; winner_member_id: string | null; winner_address: string | null }> {
  const { data, error } = await service()
    .from("raffles")
    .select("id, status, winner_member_id, winner_address")
    .eq("chain_id", CHAIN_ID)
    .eq("title", title)
    .single<{ id: string; status: string; winner_member_id: string | null; winner_address: string | null }>();
  expect(error).toBeNull();
  return data!;
}

/** "YYYY-MM-DDTHH:mm" `hours` from now in the browser's own time zone (what a datetime-local input takes). */
const localInFuture = (page: Page, hours: number) =>
  page.evaluate((h) => {
    const d = new Date(Date.now() + h * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, hours);

/** The admin creates a raffle from the panel and returns the commitment the success message shows. */
async function createRaffle(title: string, prize: string, token: "USDC" | "WETH", mode: "Igualitario" | "Ponderado por participación"): Promise<string> {
  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  await panelSection(p, "Sorteos").getByRole("button", { name: "Crear sorteo" }).click();
  const dialog = p.getByRole("dialog", { name: "Crear sorteo" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Título").fill(title);
  if (token === "WETH") await dialog.getByRole("radio", { name: "WETH" }).check();
  await dialog.getByLabel("Premio", { exact: true }).fill(prize);
  await dialog.getByLabel("Cierre").fill(await localInFuture(p, 2));
  await dialog.getByRole("radio", { name: mode }).check();
  await dialog.getByRole("button", { name: "Crear sorteo" }).click();
  const status = dialog.getByRole("status");
  await expect(status).toContainText("Sorteo creado. Su compromiso ya es público: 0x");
  const commit = /0x[0-9a-f]{64}/.exec((await status.textContent()) ?? "")?.[0];
  expect(commit).toBeDefined();
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();
  await expect(dialog).toBeHidden();
  return commit!;
}

/** A member clicks Participar on a card and sees themself inside. */
async function join(actor: Actor, title: string) {
  const p = actor.page;
  await p.goto("/dao");
  await p.waitForLoadState("networkidle");
  const c = card(p, title);
  await c.getByRole("button", { name: "Participar" }).click();
  await expect(c.getByText("Estás dentro")).toBeVisible();
  await expect(c.getByRole("button", { name: "Salir del sorteo" })).toBeEnabled();
}

test.beforeAll(async ({ browser }) => {
  // Raffles need a known fund: the local chain's DAO starts from zero whatever ran before.
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
  // A shows by name, B stays hidden (dao_ranking_visible), whatever earlier specs left on these accounts.
  for (const [id, visible] of [
    [a.id, true],
    [b.id, false],
  ] as const) {
    const { error } = await service().from("members").update({ dao_ranking_visible: visible }).eq("id", id);
    expect(error).toBeNull();
  }
  // joinAs already opened a page; wallet scripts only apply to pages created afterwards.
  await a.page.close();
  walletA = await installTestWallet(a.context, { address: memberA.address });
  a.page = await a.context.newPage();
  await a.page.setViewportSize(desktop);
  await b.page.setViewportSize(desktop);
});

test.afterAll(async () => {
  for (const x of [admin, a, b]) await x?.context.close();
  // Leave chain 59141's DAO clean (no raffles, weighted switch back on) for later specs and for a real Safe (F4a-R12).
  await resetLocalDao();
});

test("1. setup: a fresh Safe, A's 10 USDC credited, 0,01 WETH from outside, a snapshot at 35 USD", async () => {
  const p = admin.page;
  await p.goto("/settings/economia");
  await expect(p.getByRole("heading", { level: 2, name: "Economía" })).toBeVisible();
  await p.waitForLoadState("networkidle");
  await p.getByLabel(`Safe (${SEPOLIA})`, { exact: true }).fill(safe);
  await p.getByLabel(`Wallet de la plataforma (${SEPOLIA})`, { exact: true }).fill(platform.address);
  await p.getByRole("button", { name: `Guardar direcciones de ${SEPOLIA}` }).click();
  await expect(p.getByText("Direcciones guardadas.")).toBeVisible();
  expect(await tokenBalance(safe)).toBe(0n);

  // A donates 10 USDC through the dialog, at 1 USD per participación (nobody holds shares yet).
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
  expect(walletA.sent.length - sentBefore).toBeGreaterThanOrEqual(1);
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();
  expect(await tokenBalance(safe)).toBe(usdc("10"));

  // The cron's first run on this Safe: first valuation and the scan cursor.
  const first = await runCron();
  expect(first.error).toBeUndefined();
  expect(first.snapshot).toBe("taken");

  // 0,01 WETH from outside the app (25 USD at the mock feed's 2500 USD), then a fresh snapshot values it.
  await sendCall(stranger.address, WETH_ADDRESS, wethAbi, "deposit", [], parseEther("0.01"));
  await sendToken(stranger.address, safe, parseEther("0.01"), WETH_ADDRESS);
  await mineBlock();
  await ageSnapshots();
  const second = await runCron();
  expect(second.error).toBeUndefined();
  expect(second.snapshot).toBe("taken");

  await pa.goto("/dao");
  await expect(pa.getByTestId("dao-balance")).toHaveText("35 USD");
  await expect(pa.getByTestId("dao-share-price")).toHaveText("3,5 USD");
});

test("2. create (USDC): the commitment is public at once and the share value drops by 2 USD / 10 participaciones", async () => {
  const before = await sharePrice(a.page);
  const commit = await createRaffle(TITLES.usdc, "2", "USDC", "Igualitario");
  ids.usdc = (await raffleRow(TITLES.usdc)).id;

  const pa = a.page;
  const after = await sharePrice(pa);
  expect(after).toBeCloseTo(before - 2 / 10, 6);
  const c = card(pa, TITLES.usdc);
  await expect(c).toBeVisible();
  await expect(c.getByText(`Compromiso: ${commit}`)).toBeVisible();
  await expect(c).toContainText("Abierto");
  await expect(c).toContainText("Premio: 2 USDC");
});

test("3. join: A and B join (B leaves and joins again); B is listed as Anónimo #1 for A", async () => {
  await join(a, TITLES.usdc);
  await join(b, TITLES.usdc);

  const pb = b.page;
  const c = card(pb, TITLES.usdc);
  await c.getByRole("button", { name: "Salir del sorteo" }).click();
  await expect(c.getByRole("button", { name: "Participar" })).toBeEnabled();
  await expect(c.getByText("Estás dentro")).toHaveCount(0);
  await c.getByRole("button", { name: "Participar" }).click();
  await expect(c.getByText("Estás dentro")).toBeVisible();

  await pb.goto("/dao");
  await expect(card(pb, TITLES.usdc)).toContainText("Participantes: 2");

  const pa = a.page;
  await pa.goto(`/dao/sorteos/${ids.usdc}`);
  await expect(pa.getByRole("heading", { level: 1, name: TITLES.usdc })).toBeVisible();
  const list = pa.getByRole("list", { name: "Participantes" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").filter({ hasText: `${LABEL_A} (tú)` })).toHaveCount(1);
  await expect(list.getByRole("listitem").filter({ hasText: "Anónimo #1" })).toHaveCount(1);
  await expect(list).not.toContainText(NAMES.b);
  await expect(list).not.toContainText(handleOf(memberB.privateKey));
});

test("4. close and draw: the cron closes, draws with the first finalized block after the close, and the browser verifies it", async () => {
  await ageRaffle(ids.usdc, 60);
  await mineBlock();
  await mineBlock();
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.raffles).toMatchObject({ closed: 1, drawn: 1, pending: 0, refusedDraws: [] });

  const row = await raffleRow(TITLES.usdc);
  expect(row.status).toBe("drawn");
  expect([a.id, b.id]).toContain(row.winner_member_id);
  winner = { id: row.winner_member_id!, address: row.winner_address! };
  const winnerActor = winner.id === a.id ? a : b;
  const loser = winner.id === a.id ? b : a;

  // A is shown by name, B (hidden) as Anónimo on cards.
  const pa = a.page;
  await pa.goto("/dao");
  const c = card(pa, TITLES.usdc);
  await expect(c).toContainText("Resuelto · pendiente de pago");
  await expect(c.getByText(`Ganador: ${winner.id === a.id ? LABEL_A : "Anónimo"}`)).toBeVisible();
  await expect(c.getByText(/^Semilla: 0x[0-9a-f]{64}$/)).toBeVisible();

  // The winner's bell carries the win; the loser's does not; the treasurer is told a prize is owed.
  expect(await noticesOf(winner.id, "raffle_won")).toBe(1);
  expect(await noticesOf(loser.id, "raffle_won")).toBe(0);
  expect(await noticesOf(admin.id, "treasury_notice")).toBeGreaterThanOrEqual(1);
  const wp = winnerActor.page;
  await wp.goto("/notifications");
  await expect(wp.getByRole("list", { name: "Notificaciones" }).getByText(`Has ganado el sorteo «${TITLES.usdc}»`)).toHaveCount(1);
  await wp.goto("/dao");
  await expect(card(wp, TITLES.usdc).getByText("¡Has ganado!")).toBeVisible();

  // The public verifier, in A's browser, against the local chain.
  await pa.goto(`/dao/sorteos/${ids.usdc}`);
  await pa.waitForLoadState("networkidle");
  await pa.getByRole("button", { name: "Comprobar en este navegador" }).click();
  await expect(pa.getByText(/^Comprobado: el compromiso coincide y gana la participación #[12]\.$/)).toBeVisible();
  const checks = pa.getByRole("list", { name: "Comprobaciones" }).getByRole("listitem");
  await expect(checks).toHaveCount(3);
  await expect(checks.filter({ hasText: "coincide con el de la red" })).toHaveCount(1);
  await expect(checks.filter({ hasText: "La hora del bloque coincide con la guardada." })).toHaveCount(1);
  await expect(checks.filter({ hasText: "es el primer bloque posterior al cierre" })).toHaveCount(1);
  await expect(pa.getByText(/^No coincide/)).toHaveCount(0);
  await expect(pa.getByText("No se pudo consultar la red")).toHaveCount(0);
});

test("5. pay by hash: the pasted transfer is verified, the cron marks it paid, the outflow is a «Premio de sorteo»", async () => {
  const outflowsBefore = await noticesOf(admin.id, "treasury_outflow");
  const hash = await safeTransfer(safe, winner.address, usdc("2"));

  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  await panelRow(p, TITLES.usdc).getByRole("button", { name: "Marcar como pagado" }).click();
  const dialog = p.getByRole("dialog", { name: "Marcar como pagado" });
  await dialog.getByLabel("Hash de la transacción").fill(hash);
  await dialog.getByRole("button", { name: "Comprobar pago" }).click();
  await expect(dialog.getByText("Pago verificado. El sorteo quedará pagado cuando la red lo finalice.")).toBeVisible();
  await dialog.locator('[data-slot="button"]', { hasText: /^Cerrar$/ }).click();

  await mineBlock(); // the scan stops one block below the tip
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.raffles).toMatchObject({ paid: 1, reverted: 0 });
  expect((await raffleRow(TITLES.usdc)).status).toBe("paid");

  const pa = a.page;
  await pa.goto("/dao");
  await expect(card(pa, TITLES.usdc)).toContainText("Pagado");
  await expect(card(pa, TITLES.usdc)).not.toContainText("Pagado con retraso");
  const out = operationsList(pa).getByRole("listitem").filter({ hasText: "2 USDC" });
  await expect(out).toHaveCount(1);
  await expect(out).toContainText("Premio de sorteo");
  await expect(out.getByText("Sin explicar")).toHaveCount(0);
  // A real prize payout never alerts the treasurers.
  expect(await noticesOf(admin.id, "treasury_outflow")).toBe(outflowsBefore);
});

test("6. weighted WETH: B weighs 0 and A wins; unpaid after 14 days; the Safe's transfer is detected as paid late", async () => {
  await createRaffle(TITLES.weth, "0,005", "WETH", "Ponderado por participación");
  ids.weth = (await raffleRow(TITLES.weth)).id;

  // B has no participaciones: the card says they would weigh 0.
  const pb = b.page;
  await pb.goto("/dao");
  await expect(card(pb, TITLES.weth)).toContainText("Ahora no tienes: puedes apuntarte, pero pesarías 0 y no podrías ganar.");
  await join(a, TITLES.weth);
  await join(b, TITLES.weth);

  await ageRaffle(ids.weth, 60);
  await mineBlock();
  await mineBlock();
  const drawn = await runCron();
  expect(drawn.error).toBeUndefined();
  expect(drawn.raffles).toMatchObject({ closed: 1, drawn: 1 });
  const row = await raffleRow(TITLES.weth);
  expect(row.status).toBe("drawn");
  expect(row.winner_member_id).toBe(a.id);

  // 15 days later, still unpaid: the card and the panel flag it.
  await ageDraw(ids.weth, 15);
  const unpaid = await runCron();
  expect(unpaid.error).toBeUndefined();
  expect(unpaid.raffles).toMatchObject({ unpaidNotices: 1 });
  const pa = a.page;
  await pa.goto("/dao");
  await expect(card(pa, TITLES.weth)).toContainText("Impagado · más de 14 días sin pagar");
  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await expect(panelSection(p, "Avisos").getByRole("link", { name: `Premio impagado: ${TITLES.weth} · 0,005 WETH` })).toBeVisible();

  // The Safe pays in WETH without anyone pasting the hash: the cron links, verifies, records and finalizes it.
  await safeTransfer(safe, memberA.address, parseEther("0.005"), WETH_ADDRESS);
  await mineBlock();
  const detected = await runCron();
  expect(detected.error).toBeUndefined();
  expect(detected.raffles).toMatchObject({ recorded: 1, paid: 1, reverted: 0 });
  expect((await raffleRow(TITLES.weth)).status).toBe("paid");
  await pa.goto("/dao");
  await expect(card(pa, TITLES.weth)).toContainText("Pagado con retraso");
  await p.goto("/dao/tesoreria");
  await expect(panelSection(p, "Avisos").getByText(/Premio impagado/)).toHaveCount(0);
});

test("7. cancel and void: a cancelled raffle shows its reason and gives the share value back; an empty one has no winner", async () => {
  const pa = a.page;
  const before = await sharePrice(pa);
  await createRaffle(TITLES.cancel, "1", "USDC", "Igualitario");
  ids.cancel = (await raffleRow(TITLES.cancel)).id;
  expect(await sharePrice(pa)).toBeLessThan(before);

  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  await panelRow(p, TITLES.cancel).getByRole("button", { name: "Cancelar sorteo" }).click();
  const dialog = p.getByRole("dialog", { name: "Cancelar sorteo" });
  await dialog.getByLabel("Motivo").fill(CANCEL_REASON);
  await dialog.getByRole("button", { name: "Cancelar sorteo" }).click();
  await expect(dialog).toBeHidden();
  expect((await raffleRow(TITLES.cancel)).status).toBe("cancelled");

  expect(await sharePrice(pa)).toBe(before);
  await expect(card(pa, TITLES.cancel)).toContainText(`Cancelado: ${CANCEL_REASON}`);

  // Nobody joins: once past its close the cron voids it (the seed is revealed, the prize released).
  await createRaffle(TITLES.void, "1", "USDC", "Igualitario");
  ids.void = (await raffleRow(TITLES.void)).id;
  await ageRaffle(ids.void, 60);
  const report = await runCron();
  expect(report.error).toBeUndefined();
  expect(report.raffles).toMatchObject({ voided: 1 });
  expect((await raffleRow(TITLES.void)).status).toBe("void");
  expect(await sharePrice(pa)).toBe(before);
  const c = card(pa, TITLES.void);
  await expect(c).toContainText("Sin ganador");
  await expect(c.getByText(/^Semilla: 0x[0-9a-f]{64}$/)).toBeVisible();
  await expect(c.getByText(/^Ganador:/)).toHaveCount(0);
});

test("8. switch: the SuperAdmin turns weighted raffles off for Linea Sepolia and the create dialog disables that mode", async () => {
  const p = admin.page;
  await p.goto("/dao/tesoreria");
  await p.waitForLoadState("networkidle");
  const toggle = p.getByRole("switch", { name: "Sorteos ponderados en Linea Sepolia" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // Mainnet stays off.
  await expect(p.getByRole("switch", { name: "Sorteos ponderados en Linea", exact: true })).toHaveAttribute("aria-checked", "false");

  await p.reload();
  await p.waitForLoadState("networkidle");
  await panelSection(p, "Sorteos").getByRole("button", { name: "Crear sorteo" }).click();
  const dialog = p.getByRole("dialog", { name: "Crear sorteo" });
  await expect(dialog).toBeVisible();
  const weighted = dialog.getByRole("radio", { name: "Ponderado por participación" });
  await expect(weighted).toBeDisabled();
  await expect(weighted).toHaveAccessibleDescription("Los sorteos ponderados no están activados en esta red.");
  await expect(dialog.getByRole("radio", { name: "Igualitario" })).toBeChecked();
  await p.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("9. no browser errors in any context", () => {
  const coopOn404 = (e: string) => /^(B )?console: Error checking Cross-Origin-Opener-Policy: HTTP error! status: 404 @/.test(e);
  expect(browserErrors.filter((e) => !coopOn404(e))).toEqual([]);
});
