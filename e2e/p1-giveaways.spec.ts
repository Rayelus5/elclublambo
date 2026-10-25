import { createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAINS, CLUB_SAFE, hardhatAccount } from "./chain/shared.mjs";
import { E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { createInvite, joinAs, rpcAs, service, type Actor } from "./helpers/f2c";

// P1 acceptance of the giveaways (/sorteos): free, equal-weight, drawn with drand. The treasurer (the e2e SuperAdmin,
// ADMINISTRATOR) creates a giveaway with a USDC prize on Base Sepolia, a role and «Camiseta»; three members join (one
// leaves and comes back). Closing is deterministic: closes_at (and the drand round it implies) is moved into the past
// with the service client and the hourly cron is called over HTTP; the local drand (e2e/mock/drand.mjs, its own TEST-ONLY
// BLS key) answers the round. The verifier runs in the browser against the same mock. The USDC prize is paid by the Safe
// itself on the local Hardhat node (impersonated). Scenarios share state: run serially.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const desktop = { width: 1280, height: 900 };
const CRON_SECRET = "e2e-cron-secret";
const STAMP = Date.now().toString(36);
const TITLE = `Sorteo e2e ${STAMP}`;
const ROLE_NAME = `Afortunado ${STAMP}`;
const DRAND_GENESIS = 1692803367;

// WalletConnect telemetry is rate limited (429) when the suite runs repeatedly: not an app error.
const THIRD_PARTY_TELEMETRY = "https://pulse.walletconnect.org/";
const browserErrors: string[] = [];
function trackErrors(context: BrowserContext) {
  context.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.startsWith(THIRD_PARTY_TELEMETRY)) browserErrors.push(`console: ${m.text()} @ ${m.location().url} (page ${m.page()?.url()})`);
  });
  context.on("weberror", (e) => browserErrors.push(`pageerror: ${e.error().message}`));
}

/** The hourly cron, as the scheduler calls it: it closes the due giveaways and draws the ones whose round exists. */
async function runCron() {
  const res = await fetch("http://localhost:3000/api/cron/dao", { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status).toBe(200);
}

/**
 * Moves a giveaway's close 30 s into the past (service role) together with its drand round, which create_giveaway fixed
 * from the original close (P1-R10: the first round strictly after it). The round is then already emitted.
 */
async function ageGiveaway(id: string) {
  const close = Date.now() - 30_000;
  const round = Math.floor((close / 1000 - DRAND_GENESIS) / 3) + 2;
  const { data, error } = await service()
    .from("giveaways")
    .update({ closes_at: new Date(close).toISOString(), target_round: round })
    .eq("id", id)
    .select("id");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
}

type PrizeRow = { id: string; rank: number; kind: string; status: string; role_id: string | null; winner_member_id: string | null; winner_address: string | null; amount: string | null };
async function prizesOf(id: string): Promise<PrizeRow[]> {
  const { data, error } = await service()
    .from("giveaway_prizes")
    .select("id, rank, kind, status, role_id, winner_member_id, winner_address, amount:amount::text")
    .eq("giveaway_id", id)
    .order("rank");
  expect(error).toBeNull();
  return (data ?? []) as PrizeRow[];
}
const statusOf = async (id: string) => (await service().from("giveaways").select("status").eq("id", id).single<{ status: string }>()).data?.status;

/** A datetime-local value (the browser's zone, which is this process's) `ms` from now. */
function localIn(ms: number): string {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const rpcUrl = CHAINS[BASE].rpcUrl;
const localChain = { id: BASE, name: "Local Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
async function hardhatRpc(method: string, params: unknown[] = []) {
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}
/** A USDC transfer sent by `from` (a Hardhat account or an impersonated one) on the local Base Sepolia node. */
async function usdcTransfer(from: `0x${string}`, to: `0x${string}`, units: bigint): Promise<`0x${string}`> {
  const wallet = createWalletClient({ account: from, chain: localChain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({ address: CHAINS[BASE].usdc as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [to, units] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return hash;
}
/** The Safe pays, as its signers would from the Safe app: impersonated, with gas money only for the call. */
async function safePays(to: `0x${string}`, units: bigint): Promise<`0x${string}`> {
  const safe = CLUB_SAFE as `0x${string}`;
  await usdcTransfer(hardhatAccount(0).address, safe, units);
  await hardhatRpc("hardhat_setBalance", [safe, "0xde0b6b3a7640000"]);
  await hardhatRpc("hardhat_impersonateAccount", [safe]);
  try {
    return await usdcTransfer(safe, to, units);
  } finally {
    await hardhatRpc("hardhat_stopImpersonatingAccount", [safe]);
    await hardhatRpc("hardhat_setBalance", [safe, "0x0"]);
  }
}

let admin: Actor;
const members: Actor[] = [];
let giveawayId = "";
let roleId = "";

test.beforeAll(async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: desktop });
  trackErrors(adminContext);
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  admin = { context: adminContext, page: await adminContext.newPage(), id: "" };
  for (const name of ["Participante A", "Participante B", "Participante C"]) {
    const m = await joinAs(browser, newWalletKey(), await createInvite(admin.page), name, undefined, trackErrors);
    await m.page.setViewportSize(desktop);
    members.push(m);
  }
  // A member-safe role (VIEW_CHANNEL only), below everyone with rank: a role prize create_giveaway accepts (P1-R9).
  const role = await service().from("roles").insert({ name: ROLE_NAME, color: "#22D3EE", position: 1, permissions: 1 }).select("id").single<{ id: string }>();
  expect(role.error).toBeNull();
  roleId = role.data!.id;
});

test.afterAll(async () => {
  for (const x of [admin, ...members]) await x?.context.close();
});

const prizeRow = (page: Page, text: string) => page.getByRole("list", { name: "Premios del sorteo" }).getByRole("listitem").filter({ hasText: text });

test("1. the treasurer creates a giveaway with USDC on Base Sepolia, a role and «Camiseta»", async () => {
  const page = admin.page;
  await page.goto("/sorteos");
  await page.getByRole("button", { name: "Crear sorteo" }).click();
  const dialog = page.getByRole("dialog", { name: "Crear sorteo" });
  await expect(dialog.getByText("Gratis: nunca se paga por participar. Todos tienen la misma probabilidad.")).toBeVisible();
  await dialog.getByLabel("Título").fill(TITLE);
  // Two hours ahead (test 3 moves the close into the past): the server wants at least 10 minutes, and a local time within
  // an hour of a DST change back is ambiguous and read an hour earlier, so a 12-minute close failed on that night.
  await dialog.getByLabel("Cierre").fill(localIn(2 * 3600_000));

  const first = dialog.getByRole("group", { name: "Premio 1" });
  await first.getByRole("radio", { name: /Base Sepolia/ }).click();
  await first.getByLabel("Importe en USDC").fill("5");

  const add = dialog.getByRole("button", { name: "Añadir premio" });
  await add.click();
  const second = dialog.getByRole("group", { name: "Premio 2" });
  await second.getByRole("radio", { name: "Rol" }).click();
  await second.getByRole("combobox", { name: "Rol" }).selectOption({ label: ROLE_NAME });

  await add.click();
  const third = dialog.getByRole("group", { name: "Premio 3" });
  await third.getByRole("radio", { name: "Otro" }).click();
  await third.getByRole("textbox", { name: "Premio", exact: true }).fill("Camiseta");

  await dialog.getByRole("button", { name: "Crear sorteo" }).click();
  await page.waitForURL(/\/sorteos\/[0-9a-f-]{36}$/);
  giveawayId = page.url().split("/").pop()!;

  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(prizeRow(page, "5 USDC")).toContainText("Por sortear");
  await expect(prizeRow(page, ROLE_NAME)).toBeVisible();
  await expect(prizeRow(page, "Camiseta")).toBeVisible();
  await expect(page.getByText("Antes de empezar publicamos la huella de una semilla secreta.")).toBeVisible();

  const prizes = await prizesOf(giveawayId);
  expect(prizes.map((p) => p.kind)).toEqual(["crypto", "role", "custom"]);
  expect(prizes[0]!.amount).toBe("5000000");
  expect(prizes[1]!.role_id).toBe(roleId);
});

test("2. three members join; one leaves and joins again", async () => {
  for (const m of members) {
    await m.page.goto("/sorteos");
    const card = m.page.getByRole("article", { name: TITLE });
    await expect(card.getByText(/^Cierra en /)).toBeVisible();
    await card.getByRole("button", { name: "Participar" }).click();
    await expect(card.getByRole("button", { name: "Salir" })).toBeVisible();
  }
  const b = members[1]!;
  const card = b.page.getByRole("article", { name: TITLE });
  await card.getByRole("button", { name: "Salir" }).click();
  await expect(card.getByRole("button", { name: "Participar" })).toBeVisible();
  await card.getByRole("button", { name: "Participar" }).click();
  await expect(card.getByRole("button", { name: "Salir" })).toBeVisible();

  const { data, error } = await service().from("giveaway_entries").select("member_id").eq("giveaway_id", giveawayId).order("entered_at");
  expect(error).toBeNull();
  // B re-entered last: the order of entry decides the positions at the close.
  expect((data ?? []).map((e: { member_id: string }) => e.member_id)).toEqual([members[0]!.id, members[2]!.id, members[1]!.id]);

  await b.page.goto(`/sorteos/${giveawayId}`);
  await expect(b.page.getByRole("list", { name: "Lista de participantes" }).getByRole("listitem")).toHaveCount(3);
});

test("3. after the close the cron draws it: the role winner holds the role and is notified", async () => {
  await ageGiveaway(giveawayId);
  await runCron();
  await expect.poll(() => statusOf(giveawayId)).toBe("drawn");

  const prizes = await prizesOf(giveawayId);
  expect(prizes.map((p) => p.status)).toEqual(["awarded", "delivered", "awarded"]);
  const winners = prizes.map((p) => p.winner_member_id);
  expect(new Set(winners).size).toBe(3);

  const roleWinner = prizes[1]!.winner_member_id!;
  const held = await service().from("member_roles").select("role_id").eq("member_id", roleWinner).eq("role_id", roleId);
  expect(held.error).toBeNull();
  expect(held.data ?? []).toHaveLength(1);

  for (const w of winners) {
    const n = await service().from("notifications").select("id").eq("recipient_id", w!).eq("kind", "giveaway_won");
    expect(n.data ?? []).toHaveLength(1);
  }
  const winner = members.find((m) => m.id === roleWinner)!;
  await winner.page.goto("/notifications");
  const notice = winner.page.getByRole("link", { name: new RegExp(`Has ganado «${ROLE_NAME}» en «${TITLE}»`) });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("href", `/sorteos/${giveawayId}`);

  await winner.page.goto(`/sorteos/${giveawayId}`);
  await expect(prizeRow(winner.page, ROLE_NAME)).toContainText("Rol asignado");
  await expect(prizeRow(winner.page, "5 USDC")).toContainText("Pendiente de pago");
  await expect(winner.page.getByText("Has ganado", { exact: true })).toBeVisible();
});

test("4. «Comprobar» recomputes the draw in the browser: 3 ✓", async () => {
  const page = members[0]!.page;
  await page.goto(`/sorteos/${giveawayId}`);
  await page.getByRole("button", { name: "Comprobar" }).click();
  const result = page.getByRole("list", { name: "Resultado de la comprobación" });
  await expect(result.getByRole("img", { name: "Correcto" })).toHaveCount(3);
  await expect(result.getByRole("img", { name: "No coincide" })).toHaveCount(0);
});

test("5. «Marcar pagado» with a real USDC transfer from the Safe: «Pagado»", async () => {
  const usdc = (await prizesOf(giveawayId))[0]!;
  expect(usdc.winner_address).toMatch(/^0x[0-9a-f]{40}$/);
  const hash = await safePays(usdc.winner_address as `0x${string}`, BigInt(usdc.amount!));
  await hardhatRpc("evm_mine");

  const page = admin.page;
  await page.goto(`/sorteos/${giveawayId}`);
  await prizeRow(page, "5 USDC").getByRole("button", { name: "Marcar pagado" }).click();
  const dialog = page.getByRole("dialog", { name: "Marcar pagado" });
  await dialog.getByLabel("Hash de la transacción").fill(hash);
  await dialog.getByRole("button", { name: "Marcar pagado" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const row = prizeRow(page, "5 USDC");
  await expect(row).toContainText("Pagado");
  await expect(row.getByRole("link", { name: /Ver transacción/ })).toHaveAttribute("href", new RegExp(hash));
  expect((await prizesOf(giveawayId))[0]!.status).toBe("paid");
});

test("6. «Marcar entregado» on the «Otro» prize", async () => {
  const page = admin.page;
  await page.goto(`/sorteos/${giveawayId}`);
  await prizeRow(page, "Camiseta").getByRole("button", { name: "Marcar entregado" }).click();
  await expect(prizeRow(page, "Camiseta")).toContainText("Entregado");
  expect((await prizesOf(giveawayId))[2]!.status).toBe("delivered");
});

test("7. a giveaway nobody joined ends void", async () => {
  const title = `Vacío ${STAMP}`;
  const created = await rpcAs(admin.context, "create_giveaway", {
    p_title: title,
    p_description: null,
    p_closes_at: new Date(Date.now() + 11 * 60_000).toISOString(),
    p_prizes: [{ kind: "custom", label: "Gorra" }],
  });
  expect(created.error).toBeNull();
  const id = (created.data as { id: string }).id;
  await ageGiveaway(id);
  await runCron();
  await expect.poll(() => statusOf(id)).toBe("void");

  const page = members[0]!.page;
  await page.goto("/sorteos");
  const ended = page.getByRole("region", { name: "Terminados" });
  await expect(ended.getByRole("article", { name: title })).toContainText("Sin participantes");
});

test("8. no console errors along the way", async () => {
  expect(browserErrors).toEqual([]);
});
