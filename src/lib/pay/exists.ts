import "server-only";
import { toInternalPath } from "@/lib/i18n/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeError } from "@/lib/security/redact";

// Solo la página de pago de un alias (no su `badge` ni las imágenes OG), en el árbol interno.
const PAY_ALIAS_PAGE = /^\/(?:es|en)\/pay\/([a-z0-9_]{3,20})$/;
// `/pay…` o `/en/pay…`, en la URL pública.
const PAY_PATH = /^(?:\/en)?\/pay(?:\/|$)/;

/** The alias of an internal pay page path (`/{lang}/pay/<alias>`), or null (an address, a receipt, a suffix route…). */
export function payAliasPageAlias(internalPath: string): string | null {
  return PAY_ALIAS_PAGE.exec(internalPath)?.[1] ?? null;
}

/**
 * A public `/pay…` URL that is not in the closed route map (`/pay`, `/pay/ab`, `/pay/x/y`…): no page answers it, but the
 * `[lang]` layout would stream a 200, so the proxy decides the 404.
 */
export function isInvalidPayPath(pathname: string): boolean {
  return PAY_PATH.test(pathname) && toInternalPath(pathname) === null;
}

/**
 * Whether `internalPath` is the pay page of an alias nobody owns. The page streams under <Suspense>, so its notFound()
 * would answer 200: the proxy decides the 404 with this read (service role, nothing is granted to anon). An address
 * never 404s; a read error answers false and lets the page report it.
 */
export async function isMissingPayAlias(internalPath: string): Promise<boolean> {
  const alias = payAliasPageAlias(internalPath);
  if (!alias) return false;
  const { data, error } = await createAdminClient().rpc("public_profile_view", { p_target: alias });
  if (error) {
    console.error("[pay] alias existence check failed", safeError(error.message));
    return false;
  }
  return data === null || data === undefined;
}
