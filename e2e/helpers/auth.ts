import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { buildLoginMessage, generateNonce } from "../../src/lib/web3/siwe";

/**
 * TEST-ONLY key. Its address is injected as SUPER_ADMIN_WALLET into the E2E dev server
 * (playwright.config.ts). It has never held funds and must never be a real wallet.
 */
export const E2E_SUPER_ADMIN_PK: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const E2E_SUPER_ADMIN_ADDRESS = privateKeyToAccount(E2E_SUPER_ADMIN_PK).address;

export const newWalletKey = (): Hex => generatePrivateKey();
export const addressOf = (pk: Hex) => privateKeyToAccount(pk).address.toLowerCase();

const ORIGIN = "http://localhost:3000";
const CHAIN_ID = 59141; // linea sepolia

type Jar = { name: string; value: string };

/**
 * Signs in with Supabase Web3 Auth in Node (no browser wallet), injects the session cookies
 * into the Playwright context and runs the app's /login/complete handler.
 */
export async function loginAs(
  context: BrowserContext,
  pk: Hex,
  opts: { invite?: string; onboard?: boolean } = {},
): Promise<string> {
  const { onboard = true } = opts;
  const account = privateKeyToAccount(pk);
  const message = buildLoginMessage({
    address: account.address,
    chainId: CHAIN_ID,
    nonce: generateNonce(),
    domain: "localhost:3000",
    uri: `${ORIGIN}/login`,
  });
  const signature = await account.signMessage({ message });

  const jar = new Map<string, Jar>();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...jar.values()],
        setAll: (cookies) => cookies.forEach((c) => jar.set(c.name, { name: c.name, value: c.value })),
      },
    },
  );
  const { error } = await supabase.auth.signInWithWeb3({ chain: "ethereum", message, signature });
  if (error) throw new Error(`signInWithWeb3 failed: ${error.message}`);

  await context.clearCookies();
  await context.addCookies([...jar.values()].map((c) => ({ ...c, domain: "localhost", path: "/" })));

  const page = await context.newPage();
  await page.goto("/login/complete" + (opts.invite ? `?invite=${encodeURIComponent(opts.invite)}` : ""));
  await page.waitForLoadState("domcontentloaded");
  let landed = page.url();
  if (onboard) {
    // Existing specs expect to land in the forum: give an active member without a handle a deterministic one and mark
    // the welcome as done (service role; the welcome flow itself is covered by its own spec with onboard: false).
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const wallet = account.address.toLowerCase();
    const { data: member, error: readError } = await db
      .from("members")
      .select("id, handle, status")
      .eq("wallet_address", wallet)
      .maybeSingle<{ id: string; handle: string | null; status: string }>();
    if (readError) throw new Error(`onboarding read failed: ${readError.message}`);
    if (member && member.status === "active" && member.handle === null) {
      const { error: updateError } = await db
        .from("members")
        .update({ handle: "u_" + wallet.slice(2, 12), welcome_completed_at: new Date().toISOString() })
        .eq("id", member.id);
      if (updateError) throw new Error(`onboarding update failed: ${updateError.message}`);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      landed = page.url();
    }
  }
  await page.close();
  return landed;
}
