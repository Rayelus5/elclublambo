import { expect, test, type Page } from "@playwright/test";
import { clubPath, addressOf, E2E_SUPER_ADMIN_PK, loginAs, newWalletKey } from "./helpers/auth";
import { watchCsp } from "./helpers/csp";
import { channelIds, createInvite, joinAs, messageWith, openChannel, send, service } from "./helpers/f2c";

// F5 Task 3 (Review Focus 2): the security headers are sent, and the main browser flows run under the full CSP without
// a single `securitypolicyviolation`: the Reown modal (wallet images, fonts), a chat image (Supabase Storage signed URL),
// the DexScreener iframe of an Alpha message, Realtime (wss/ws to Supabase) and /mercado. Run in dev and E2E_PROD=1.
test.describe.configure({ mode: "serial" });

const desktop = { width: 1280, height: 900 };
// 1x1 transparent PNG: coin icons are served locally so the spec never reaches the real CoinGecko image CDN. Routing
// happens after the CSP check, so a missing img-src origin still shows up as a violation.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
// A token contract address for the Alpha card (any address renders the DexScreener chart; nothing is read on chain).
const ALPHA_ADDRESS = "0x176211869ca2b568f2a7d4ee941e073a821ee1ff";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Waits until at least one <img> under `root` (shadow DOM included) has actually loaded. */
async function expectLoadedImage(page: Page, selector: string) {
  await expect
    .poll(
      () => page.locator(selector).evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

test("GET /foro/login sends the CSP and the security headers (no HSTS over http)", async ({ request }) => {
  const res = await request.get(clubPath("/login"));
  expect(res.ok()).toBe(true);
  const h = res.headers();
  const csp = h["content-security-policy"] ?? "";
  expect(csp).toMatch(/(^|; )default-src 'self'(;|$)/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("upgrade-insecure-requests");
  // 'unsafe-eval' is a dev-only allowance (HMR); a production build must never ship it.
  if (process.env.E2E_PROD === "1") expect(csp).not.toContain("'unsafe-eval'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  expect(h["permissions-policy"]).toContain("camera=()");
  expect(h["strict-transport-security"]).toBeUndefined();
});

test("no CSP violation across the main flows", async ({ browser }) => {
  // 1. Anonymous /login: the Reown modal with its wallet images (api.web3modal.org) and fonts (fonts.reown.com).
  const anon = await browser.newContext({ viewport: desktop });
  const login = await anon.newPage();
  const readLogin = await watchCsp(login);
  await login.goto(clubPath("/login"));
  await login.getByRole("button", { name: "Conectar wallet" }).click();
  await expect(login.locator("w3m-modal").getByText("MetaMask").first()).toBeVisible({ timeout: 30_000 });
  await expectLoadedImage(login, "w3m-modal img");
  await login.waitForLoadState("networkidle");
  expect(await readLogin()).toEqual([]);
  await anon.close();

  // 2. A member uploads a chat image to General and sees it render from Storage.
  const adminContext = await browser.newContext({ viewport: desktop });
  await adminContext.route("https://coin-images.coingecko.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  await loginAs(adminContext, E2E_SUPER_ADMIN_PK);
  const page = await adminContext.newPage();
  const read = await watchCsp(page);
  await page.goto(clubPath());
  await openChannel(page, "General");
  const caption = `imagen csp ${Date.now()}`;
  await page.locator('input[type="file"]').first().setInputFiles("e2e/fixtures/avatar.png");
  const preview = page.getByRole("list", { name: "Imágenes adjuntas" }).getByRole("img", { name: "avatar.png" });
  await expect(preview).toBeVisible();
  // The preview is dimmed until the upload to Storage is done; sending earlier is refused ("Espera a que terminen…").
  await expect(preview).not.toHaveClass(/opacity-50/, { timeout: 30_000 });
  await send(page, caption);
  const posted = messageWith(page, caption);
  await expect(posted.getByRole("img", { name: "Imagen adjunta 1 de 1" })).toBeVisible({ timeout: 30_000 });
  await expectLoadedImage(page, `li[data-message-id] img[alt="Imagen adjunta 1 de 1"]`);

  // 3. An Alpha message (seeded through the service role, as the action does) mounts the DexScreener iframe.
  const admin = await service().from("members").select("id").eq("wallet_address", addressOf(E2E_SUPER_ADMIN_PK)).single<{ id: string }>();
  expect(admin.error).toBeNull();
  const trading = (await channelIds())["Trading"];
  expect(trading).toBeTruthy();
  const thesis = `tesis csp ${Date.now()}`;
  const seeded = await service().rpc("post_message_as", {
    p_member: admin.data!.id,
    p_channel: trading,
    p_body: doc(thesis),
    p_body_text: thesis,
    p_expanded: false,
    p_thread_root: null,
    p_quoted: null,
    p_attachments: [],
    p_alpha_address: ALPHA_ADDRESS,
    p_alpha_chain: 84532,
  });
  expect(seeded.error).toBeNull();
  await openChannel(page, "Trading");
  const card = messageWith(page, thesis);
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator("iframe")).toHaveAttribute("src", /^https:\/\/dexscreener\.com\/base\/0x/);

  // 4. Realtime: a second member with General open sees the first member's message arrive live.
  const other = await joinAs(browser, newWalletKey(), await createInvite(page), "Testigo CSP");
  await other.page.setViewportSize(desktop);
  const readOther = await watchCsp(other.page);
  await other.page.goto(clubPath());
  await openChannel(other.page, "General");
  await openChannel(page, "General");
  const live = `en vivo csp ${Date.now()}`;
  await send(page, live);
  await expect(messageWith(other.page, live)).toBeVisible({ timeout: 30_000 });

  // 5. /mercado.
  await page.goto(clubPath("/mercado"));
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(await read()).toEqual([]);
  expect(await readOther()).toEqual([]);
  await other.context.close();
  await adminContext.close();
});
