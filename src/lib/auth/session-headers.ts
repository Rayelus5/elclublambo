type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

type ResponseLike = {
  headers: { set(name: string, value: string): void };
  cookies: { set(name: string, value: string, options?: never): unknown };
};

/** Copies auth cookies plus the cache headers (Cache-Control: private, no-store...) that @supabase/ssr passes to setAll. */
export function applySessionHeaders<R extends ResponseLike>(
  response: R,
  cookies: CookieToSet[],
  headers: Record<string, string>,
): R {
  cookies.forEach(({ name, value, options }) =>
    (response.cookies.set as (n: string, v: string, o?: unknown) => unknown)(name, value, options),
  );
  Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}
