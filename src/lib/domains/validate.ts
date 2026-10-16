/** Mismo formato que el check de public.allowed_domains. */
export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** Trim + minúsculas; null si no cumple el formato. */
export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase();
  return DOMAIN_RE.test(d) ? d : null;
}
