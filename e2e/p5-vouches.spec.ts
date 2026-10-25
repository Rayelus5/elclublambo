import { createPublicClient, createWalletClient, http } from "viem";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CHAINS, hardhatAccount } from "./chain/shared.mjs";
import { watchCsp } from "./helpers/csp";
import { service } from "./helpers/f2c";
import { installTestWallet, signInPublic, type TestWallet } from "./helpers/wallet";
import { shortAddress } from "../src/lib/auth/wallet";
import { builderCodeSuffix } from "../src/lib/web3/builder-code";
import { EAS_ADDRESS, revokeArgs } from "../src/lib/vouches/eas";
import { easAbi } from "../src/lib/vouches/eas-abi";

// P5 acceptance of vouches (/herramientas/avales, the «Avales» section of /pay/<x>). A (no membership) signs in on the
// tool, vouches for B with EAS on the local Base Sepolia node (EAS at the OP Stack predeploys, start-chain.mjs), sees it
// in B's list and in «Tus avales», cannot vouch for itself, and shows up as @alias on /pay/<B> once it has a Pay profile.
// Review Focus 3: A revokes OUTSIDE the app (a viem wallet client straight to the node); /pay/<B> keeps showing it until
// «Actualizar» re-reads the chain. Then A vouches again and withdraws it from «Tus avales».
// TEST-ONLY wallets: Hardhat accounts 17 and 18 (public mnemonic), used by no other spec. Scenarios share state: serial.
test.describe.configure({ mode: "serial" });

const BASE = 84532;
const desktop = { width: 1280, height: 900 };
const phone = { width: 375, height: 812 };
const ALIAS = `aval_${Date.now().toString(36)}`;
const voucherA = hardhatAccount(17);
const targetB = hardhatAccount(18);
const A = voucherA.address.toLowerCase();
const B = targetB.address.toLowerCase();
const TOOL_B = `/herramientas/avales?address=${B}`;

const rpcUrl = CHAINS[BASE].rpcUrl;
const localChain = { id: BASE, name: "Local Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });

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

const received = (page: Page) => page.getByRole("region", { name: "Avales recibidos" });
const givenList = (page: Page) => page.getByRole("region", { name: "Tus avales" });
const activeUids = async () => {
  const { data, error } = await service().from("vouches").select("uid").eq("attester", A).eq("recipient", B).is("revoked_at", null);
  expect(error).toBeNull();
  return (data ?? []).map((r: { uid: string }) => r.uid);
};

let anonCtx: BrowserContext;
let aCtx: BrowserContext;
let aPage: Page;
let walletA: TestWallet;
let cspA: () => Promise<string[]>;

test.beforeAll(async ({ browser }) => {
  // Clean slate even on a database kept between runs (E2E_SKIP_RESET).
  for (const r of [
    await service().from("vouches").delete().eq("recipient", B),
    await service().from("vouches").delete().eq("attester", A),
    await service().from("public_profiles").delete().eq("wallet_address", A),
  ]) {
    expect(r.error).toBeNull();
  }
  anonCtx = await browser.newContext({ viewport: desktop });
  trackErrors(anonCtx);
  aCtx = await browser.newContext({ viewport: desktop });
  trackErrors(aCtx);
  walletA = await installTestWallet(aCtx, { address: voucherA.address });
  aPage = await aCtx.newPage();
  cspA = await watchCsp(aPage);
});

test.afterAll(async () => {
  for (const c of [anonCtx, aCtx]) await c?.close();
});

test("1. anonymous: B has no vouches yet, with the notice, and no form", async () => {
  const page = await anonCtx.newPage();
  const csp = await watchCsp(page);
  await page.goto(TOOL_B);
  await expect(page.getByRole("heading", { level: 1, name: "Avales" })).toBeVisible();
  await expect(received(page).getByText("Esta dirección aún no tiene avales.")).toBeVisible();
  await expect(page.getByText("Un aval es público y permanente en la cadena. Puedes retirarlo, pero el historial queda. ElClub. no verifica identidades.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Avalar" })).toHaveCount(0);
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  expect(await csp()).toEqual([]);
  await page.close();
});

test("2. A signs in, vouches «Hemos trabajado juntos» for B: B's list, «Tus avales» and the Builder Code suffix", async () => {
  const page = aPage;
  await page.goto(TOOL_B);
  await signInPublic(page, page.getByRole("main"));
  await expect(page.getByRole("region", { name: "Avalar a alguien" })).toBeVisible();
  expect(`${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe(TOOL_B);
  await expect(page.getByLabel("Dirección que avalas")).toHaveValue(B);

  await page.getByRole("radio", { name: "Hemos trabajado juntos" }).check();
  await page.getByRole("button", { name: "Avalar" }).click();
  await expect(page.getByText("Aval registrado.")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(1);

  const list = received(page);
  await expect(list.getByText("Hemos trabajado juntos · 1")).toBeVisible();
  await expect(list.getByRole("link", { name: shortAddress(A) })).toHaveAttribute("href", `/herramientas/avales?address=${A}`);
  const [uid] = await activeUids();
  expect(uid).toMatch(/^0x[0-9a-f]{64}$/);
  await expect(list.getByRole("link", { name: /Ver en EAS Scan/ })).toHaveAttribute("href", `https://base-sepolia.easscan.org/attestation/view/${uid}`);
  await expect(givenList(page).getByRole("button", { name: "Retirar" })).toHaveCount(1);
  await expect(givenList(page)).toContainText(B);

  // P5-R4: the attest calldata carries the ERC-8021 suffix of the TEST-ONLY Builder Code, and EAS still accepted it.
  const tx = await publicClient.getTransaction({ hash: walletA.sent[0] as `0x${string}` });
  expect(tx.to?.toLowerCase()).toBe(EAS_ADDRESS.toLowerCase());
  expect(tx.input.toLowerCase().endsWith(builderCodeSuffix(["bc_e2etest"]).slice(2).toLowerCase())).toBe(true);
});

test("3. A cannot vouch for itself: the «self» text, «Avalar» disabled, nothing signed", async () => {
  const page = aPage;
  const field = page.getByLabel("Dirección que avalas");
  await field.fill(A);
  await expect(page.getByText("No puedes avalarte a ti mismo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Avalar" })).toBeDisabled();
  expect(walletA.sent).toHaveLength(1);
});

test("4. with a Pay profile, /pay/<B> shows the «Avales» section with A as @alias; «Pagar» keeps the only brand fill", async () => {
  const page = aPage;
  await page.goto("/herramientas/pay");
  await page.getByLabel("Alias de pago").fill(ALIAS);
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Perfil guardado.")).toBeVisible();

  await page.goto(`/pay/${B}`);
  const section = page.getByRole("region", { name: "Avales" });
  await expect(section.getByText("Hemos trabajado juntos · 1")).toBeVisible();
  await expect(section.getByRole("link", { name: `@${ALIAS}` })).toHaveAttribute("href", `/pay/${ALIAS}`);
  const cta = section.getByRole("link", { name: "Avalar esta dirección" });
  await expect(cta).toHaveAttribute("href", `/herramientas/avales?address=${B}`);
  await expect(cta).toHaveAttribute("data-variant", "outline");
  await expect(section.locator(".bg-accent-fill")).toHaveCount(0);
  expect(await page.locator("main .bg-accent-fill").count()).toBeLessThanOrEqual(1);
  await page.setViewportSize(phone);
  await noHorizontalScroll(page);
  await page.setViewportSize(desktop);
});

test("5. Review Focus 3: a revocation made outside the app stays on /pay/<B> until «Actualizar» re-reads the chain", async () => {
  const page = aPage;
  const [uid] = await activeUids();
  // Outside the app: A's own (TEST-ONLY, node-unlocked) account calls EAS.revoke directly on the node.
  const wallet = createWalletClient({ account: voucherA.address as `0x${string}`, chain: localChain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "revoke", args: revokeArgs(uid as `0x${string}`) });
  expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");

  // Our index still has it: the public page shows it until someone refreshes it.
  await page.goto(`/pay/${B}`);
  await expect(page.getByRole("region", { name: "Avales" }).getByText("Hemos trabajado juntos · 1")).toBeVisible();

  await page.goto(TOOL_B);
  await received(page).getByRole("button", { name: "Actualizar" }).click();
  await expect(received(page).getByText("Esta dirección aún no tiene avales.")).toBeVisible();
  expect(await activeUids()).toEqual([]);
  await page.goto(`/pay/${B}`);
  await expect(page.getByRole("region", { name: "Avales" }).getByText("Esta dirección aún no tiene avales.")).toBeVisible();
});

test("6. A vouches again and withdraws it from «Tus avales»: it leaves B's list", async () => {
  const page = aPage;
  await page.goto(TOOL_B);
  await page.getByRole("radio", { name: "Hemos trabajado juntos" }).check();
  await page.getByRole("button", { name: "Avalar" }).click();
  await expect(page.getByText("Aval registrado.")).toBeVisible({ timeout: 60_000 });
  await expect(received(page).getByText("Hemos trabajado juntos · 1")).toBeVisible();
  expect(await activeUids()).toHaveLength(1);

  await givenList(page).getByRole("button", { name: "Retirar" }).click();
  // The row's «Aval retirado.» is transient: the refresh that follows removes the row (in a production build, before it
  // paints), so the settled outcome is the empty list.
  await expect(givenList(page).getByText("Aún no has avalado a nadie.")).toBeVisible({ timeout: 60_000 });
  expect(walletA.sent).toHaveLength(3);
  await expect.poll(activeUids).toEqual([]);
  await page.goto(TOOL_B);
  await expect(received(page).getByText("Esta dirección aún no tiene avales.")).toBeVisible();
  await expect(givenList(page).getByText("Aún no has avalado a nadie.")).toBeVisible();
});

test("7. the ES/EN switch keeps /en/tools/vouches?address=<B>; no console errors and no CSP violations", async () => {
  const page = aPage;
  await page.goto(TOOL_B);
  // The hydrated header renders the query into the language links (the server HTML has the path alone).
  const en = page.locator('a[hreflang="en"]').first();
  await expect(en).toHaveAttribute("href", `/en/tools/vouches?address=${B}`);
  await en.click();
  await expect(page).toHaveURL(new RegExp(`/en/tools/vouches\\?address=${B}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Vouches" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Vouches received" }).getByText("This address has no vouches yet.")).toBeVisible();
  const es = page.locator('a[hreflang="es"]').first();
  await expect(es).toHaveAttribute("href", `/herramientas/avales?address=${B}`);
  await es.click();
  await expect(page).toHaveURL(new RegExp(`/herramientas/avales\\?address=${B}$`));

  expect(await cspA()).toEqual([]);
  expect(browserErrors).toEqual([]);
});
