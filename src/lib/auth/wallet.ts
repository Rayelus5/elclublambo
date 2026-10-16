const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export function normalizeAddress(a: string): `0x${string}` {
  const n = a.trim().toLowerCase();
  if (!ADDRESS_RE.test(n)) throw new Error("invalid_input");
  return n as `0x${string}`;
}

/** 0x1234…abcd */
export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type UserLike = {
  identities?: Array<{ provider: string; identity_data?: Record<string, unknown> | null }>;
};

/** Wallet from the Supabase web3 identity (custom_claims.address), normalized; null if absent/malformed. */
export function walletFromUser(user: UserLike | null): `0x${string}` | null {
  const identity = user?.identities?.find((i) => i.provider === "web3");
  const claims = identity?.identity_data?.custom_claims;
  if (!claims || typeof claims !== "object") return null;
  const address = (claims as Record<string, unknown>).address;
  if (typeof address !== "string") return null;
  try {
    return normalizeAddress(address);
  } catch {
    return null;
  }
}

export function isSuperAdminWallet(address: string, envValue: string | undefined): boolean {
  if (!envValue) return false;
  try {
    return normalizeAddress(address) === normalizeAddress(envValue);
  } catch {
    return false;
  }
}
