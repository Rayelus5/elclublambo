// Which Supabase URL each side uses. The browser always uses NEXT_PUBLIC_SUPABASE_URL. The server uses
// SUPABASE_INTERNAL_URL when set: preproduction runs next to its self-hosted Supabase and reaches it over the Docker
// network, so a Cloudflare block on the public pre-api URL (Spanish ISPs during LaLiga matches) cannot hang it.
// Production leaves it unset and behaves as before. No server-only import: chat/queries runs in both.

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function resolveServerSupabaseUrl(publicUrl: string, internalUrl: string | undefined): string {
  return internalUrl?.trim() ? internalUrl.trim() : publicUrl;
}

/** supabase-js's default storage key for `publicUrl`; pinned so a server client on another URL reads the same cookie. */
export function authCookieName(publicUrl: string): string {
  return `sb-${new URL(publicUrl).hostname.split(".")[0]}-auth-token`;
}

/** A URL Supabase minted for the server (signed storage URLs) as the browser must load it. */
export function toPublicSupabaseUrl(url: string, publicUrl: string, internalUrl: string | undefined): string {
  const internal = internalUrl?.trim() ? trimSlash(internalUrl.trim()) : "";
  if (!internal || !url.startsWith(`${internal}/`)) return url;
  return trimSlash(publicUrl) + url.slice(internal.length);
}

export function serverSupabaseUrl(): string {
  return resolveServerSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_INTERNAL_URL);
}

export function publicSupabaseUrl(url: string): string {
  return toPublicSupabaseUrl(url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_INTERNAL_URL);
}
