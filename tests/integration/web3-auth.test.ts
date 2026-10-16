import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";
import { createSiweMessage } from "viem/siwe";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may come from the shell */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function reachable(): Promise<boolean> {
  if (!url || !anon) return false;
  try {
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon },
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const up = await reachable();
const skipReason = "Supabase local is not reachable (run `pnpm db:start`)";

function client() {
  return createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function login(chainId: number, account = privateKeyToAccount(generatePrivateKey())) {
  const message = buildLoginMessage({
    address: account.address,
    chainId,
    nonce: generateNonce(),
    domain: "localhost:3000",
    uri: "http://localhost:3000/login",
  });
  const signature = await account.signMessage({ message });
  const res = await client().auth.signInWithWeb3({ chain: "ethereum", message, signature });
  return { account, res };
}

describe.skipIf(!up)(`supabase native web3 auth ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  it("signs_in_and_records_web3_identity", async () => {
    const { account, res } = await login(59141);
    expect(res.error).toBeNull();
    expect(res.data.session).not.toBeNull();
    const identity = res.data.user!.identities![0]!;
    console.log("SPIKE identity:", JSON.stringify(identity, null, 2));
    console.log("SPIKE app_metadata:", JSON.stringify(res.data.user!.app_metadata));
    expect(identity.provider).toBe("web3");
    // Observed (supabase auth in this stack): the SIWE fields are nested under
    // identity_data.custom_claims, NOT top-level as the plan assumed.
    const data = identity.identity_data as Record<string, unknown>;
    expect(data.address).toBeUndefined();
    const claims = data.custom_claims as Record<string, string>;
    expect(claims.address).toBe(account.address);
    expect(claims.chain).toBe("ethereum");
    expect(identity.id).toBe(`web3:ethereum:${account.address}`);
  });

  it("same_account_returns_same_user_id", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const a = await login(59141, account);
    const b = await login(59141, account);
    expect(a.res.error).toBeNull();
    expect(b.res.error).toBeNull();
    expect(b.res.data.user!.id).toBe(a.res.data.user!.id);
  });

  it("accepts_mainnet_linea_chain_id", async () => {
    const { res } = await login(59144);
    console.log("SPIKE 59144 error:", res.error?.message ?? "none");
    expect(res.error).toBeNull();
  });

  it("observes_foreign_chain_id_handling", async () => {
    // Our client-side builder rejects chainId 1; build the message directly to see what Supabase does.
    const account = privateKeyToAccount(generatePrivateKey());
    const now = new Date();
    const message = createSiweMessage({
      address: account.address,
      chainId: 1,
      domain: "localhost:3000",
      uri: "http://localhost:3000/login",
      nonce: generateNonce(),
      version: "1",
      statement: "foreign chain probe",
      issuedAt: now,
      notBefore: now,
      expirationTime: new Date(now.getTime() + 300000),
    });
    const signature = await account.signMessage({ message });
    const res = await client().auth.signInWithWeb3({ chain: "ethereum", message, signature });
    console.log("SPIKE chainId 1 error:", res.error?.message ?? "none (accepted)");
    expect(true).toBe(true);
  });
});

describe.skipIf(up)("supabase native web3 auth (skipped)", () => {
  it.skip(skipReason, () => {});
});
