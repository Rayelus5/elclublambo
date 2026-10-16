const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export function normalizeAddress(a: string): `0x${string}` {
  const n = a.trim().toLowerCase();
  if (!ADDRESS_RE.test(n)) throw new Error("invalid_input");
  return n as `0x${string}`;
}

export function isSuperAdminWallet(address: string, envValue: string | undefined): boolean {
  if (!envValue) return false;
  try {
    return normalizeAddress(address) === normalizeAddress(envValue);
  } catch {
    return false;
  }
}
