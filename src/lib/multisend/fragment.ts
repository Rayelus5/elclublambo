// `#envio=<base64url(UTF-8 lines)>`: how «Repartir gastos» (and a shared link) preloads the multisend list. A fragment
// never reaches the server, its logs or the Referer. Pure.

const PREFIX = "envio=";
/** The longest encoded list accepted, in characters (4 KB). */
export const MAX_FRAGMENT = 4096;
const B64URL = /^[A-Za-z0-9_-]+$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The fragment (with its `#`) for these lines; throws when it would pass MAX_FRAGMENT. */
export function encodeLines(lines: string): string {
  const encoded = toBase64Url(new TextEncoder().encode(lines));
  if (encoded.length > MAX_FRAGMENT) throw new RangeError("multisend list too long for a link");
  return `#${PREFIX}${encoded}`;
}

/** The lines in a `#envio=` fragment (with or without `#`), or null for anything else. */
export function decodeLines(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h.startsWith(PREFIX)) return null;
  const encoded = h.slice(PREFIX.length);
  if (encoded.length > MAX_FRAGMENT || !B64URL.test(encoded)) return null;
  try {
    const bin = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
