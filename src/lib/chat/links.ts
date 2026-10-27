// Link guardian: decides how a link mark of a chat message is rendered. Pure, no Node/DOM-only APIs
// (it is used by components that may run on the client).

export const MAX_LINK_LENGTH = 2048;

export type LinkClass =
  | { kind: "direct"; href: string }
  | { kind: "guarded"; href: string }
  | { kind: "text"; href?: undefined };

export interface ExternalUrl {
  /** Normalized URL (host in punycode). */
  href: string;
  /** ASCII/punycode hostname. */
  host: string;
  /** Hostname decoded to Unicode (equals `host` when there is nothing to decode). */
  unicodeHost: string;
}

// ASCII control chars, whitespace and DEL anywhere in the raw href: never a legitimate link.
const FORBIDDEN = /[\u0000- \u007f]/;

/** Parses an absolute http(s) URL without credentials; null if it is anything else. */
function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LINK_LENGTH) return null;
  if (FORBIDDEN.test(raw) || !/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;
  return url;
}

function asciiHost(domain: string): string | null {
  try {
    return new URL(`http://${domain.trim()}`).hostname || null;
  } catch {
    return null;
  }
}

/** Exact host or dot-boundary subdomain of an allowed domain, on the ASCII (punycode) hostname. */
export function isAllowedHost(host: string, allowedDomains: readonly string[]): boolean {
  for (const raw of allowedDomains) {
    const d = asciiHost(raw);
    if (d && (host === d || host.endsWith(`.${d}`))) return true;
  }
  return false;
}

export function classifyLink(href: unknown, allowedDomains: readonly string[]): LinkClass {
  const url = parseHttpUrl(href);
  if (!url) return { kind: "text" };
  if (isAllowedHost(url.hostname, allowedDomains)) return { kind: "direct", href: url.href };
  const guarded = `/out?u=${encodeURIComponent(url.href)}`;
  return { kind: "guarded", href: guarded };
}

// --- punycode decoding (RFC 3492), to show the human-readable form of an IDN host ---------------

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function digitValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 22; // 0-9 -> 26..35
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}

function adapt(delta: number, numPoints: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function punycodeDecode(input: string): string | null {
  const out: number[] = [];
  const basic = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(basic, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    out.push(c);
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (idx >= input.length) return null;
      const digit = digitValue(input.charCodeAt(idx++));
      if (digit >= BASE) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...out);
  } catch {
    return null;
  }
}

export function hostToUnicode(host: string): string {
  return host
    .split(".")
    .map((label) => {
      if (!label.toLowerCase().startsWith("xn--")) return label;
      return punycodeDecode(label.slice(4).toLowerCase()) ?? label;
    })
    .join(".");
}

/** Validates the `u` param of /out. Null when it is not a plain absolute http(s) URL (<= 2048 chars). */
export function parseExternalUrl(raw: unknown): ExternalUrl | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  return { href: url.href, host: url.hostname, unicodeHost: hostToUnicode(url.hostname) };
}

/** Fail closed: any punycode label warns, even one the decoder could not turn into Unicode. */
export function needsHomographWarning(host: string, unicodeHost: string): boolean {
  return /(^|\.)xn--/i.test(host) || unicodeHost !== host;
}
