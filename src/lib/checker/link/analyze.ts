import { hostToUnicode, isAllowedHost, MAX_LINK_LENGTH, needsHomographWarning } from "@/lib/chat/links";
import { SHORTENERS } from "./lists";

// Pure link analysis (P4-R3): it only parses the text it is given, it never requests the URL (no SSRF).

export type LinkAlertCode = "punycode" | "lookalike" | "subdomain_trick" | "not_https" | "ip_host" | "credentials" | "shortener" | "unknown_domain";
export type LinkAlertSeverity = "high" | "medium" | "info";
export type LinkAlert = { code: LinkAlertCode; severity: LinkAlertSeverity; detail?: string };

export type LinkReport =
  | { ok: false; error: "invalid_url" }
  | { ok: true; url: string; host: string; hostUnicode: string; scheme: "http" | "https"; isKnown: boolean; alerts: LinkAlert[] };

const INVALID = { ok: false, error: "invalid_url" } as const;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[^/:?#]+:\d+([/?#]|$)/;
// Second-level labels that make the registrable domain three labels long (example.co.uk).
const SLD_PREFIXES = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

/** Text with a scheme (or none, then https) → a parsed http(s) URL, or null. */
function parse(input: string): URL | null {
  const raw = input.trim();
  // ASCII control chars, whitespace and DEL anywhere in the input: never a legitimate link.
  if (raw === "" || raw.length > MAX_LINK_LENGTH || /[\u0000- \u007f]/.test(raw)) return null;
  let text = raw;
  if (!EXPLICIT_SCHEME.test(raw)) {
    // `javascript:`, `data:`, `mailto:`… are rejected; `host:8080/x` is a host with a port, not a scheme.
    if (OPAQUE_SCHEME.test(raw) && !HOST_PORT.test(raw)) return null;
    text = `https://${raw.replace(/^\/\//, "")}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return url;
}

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

// Letters of other scripts that render like a Latin letter (Cyrillic, Greek, a few Latin extensions).
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i",
  "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ԛ": "q", "ԝ": "w", "к": "k", "м": "m",
  "т": "t", "н": "h", "в": "b", "α": "a", "ο": "o", "ν": "v", "ρ": "p", "τ": "t",
  "ι": "i", "κ": "k", "ε": "e", "υ": "u", "χ": "x", "ɡ": "g", "ı": "i", "ɩ": "l",
  "ӏ": "l", "ǀ": "l", "ⅼ": "l",
};

/** A label reduced to what the eye sees: accents and look-alike letters/digits folded (0→o, 1/i→l, rn→m, vv→w). */
export function skeleton(label: string): string {
  const folded = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/./gu, (c) => HOMOGLYPHS[c] ?? c);
  return folded
    .replace(/[01i|]/g, (c) => (c === "0" ? "o" : "l"))
    .replace(/rn/g, "m")
    .replace(/vv/g, "w");
}

/** The registrable domain (last two labels, three under `co.uk`-like suffixes). */
function registrable(host: string): string {
  const labels = host.split(".");
  if (labels.length >= 3 && labels[labels.length - 1]!.length === 2 && SLD_PREFIXES.has(labels[labels.length - 2]!)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

const labelOf = (domain: string): string => domain.split(".")[0] ?? domain;
const maxDistance = (len: number): number => Math.min(2, Math.floor(len / 3));

/** A known registrable domain this host imitates (similar label or same skeleton, but not the same domain). */
function findLookalike(hostUnicode: string, knownRegistrables: readonly string[]): string | null {
  const mine = registrable(hostUnicode);
  const myLabel = labelOf(mine);
  const mySkel = skeleton(myLabel);
  for (const k of knownRegistrables) {
    if (k === mine) continue;
    const kLabel = labelOf(k);
    if (skeleton(kLabel) === mySkel) return k;
    if (kLabel.length >= 4 && myLabel.length >= 4 && editDistance(myLabel, kLabel) <= maxDistance(Math.min(myLabel.length, kLabel.length))) return k;
  }
  return null;
}

/** A known domain that appears inside the host as a non-final label sequence (elclub.party.evil.io). */
function findSubdomainTrick(host: string, known: readonly string[]): string | null {
  for (const d of known) {
    if (host.startsWith(`${d}.`) || host.includes(`.${d}.`)) return d;
  }
  return null;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function analyzeLink(input: string, known: readonly string[]): LinkReport {
  const url = parse(input);
  if (!url) return INVALID;

  const host = url.hostname.replace(/\.$/, "");
  const hostUnicode = hostToUnicode(host);
  const scheme = url.protocol === "http:" ? "http" : "https";
  const knownAscii = known.map((d) => d.trim().toLowerCase()).filter(Boolean);
  const isKnown = isAllowedHost(host, knownAscii);
  const isIp = IPV4.test(host) || host.startsWith("[");
  const alerts: LinkAlert[] = [];

  if (url.username !== "" || url.password !== "") alerts.push({ code: "credentials", severity: "high" });
  if (scheme === "http") alerts.push({ code: "not_https", severity: "medium" });
  if (isIp) alerts.push({ code: "ip_host", severity: "high" });

  if (!isIp) {
    if (needsHomographWarning(host, hostUnicode)) alerts.push({ code: "punycode", severity: "high", detail: hostUnicode });
    if (SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) alerts.push({ code: "shortener", severity: "medium" });
    if (!isKnown) {
      const trick = findSubdomainTrick(host, knownAscii);
      if (trick) alerts.push({ code: "subdomain_trick", severity: "high", detail: trick });
      const like = findLookalike(hostUnicode, [...new Set(knownAscii.map((d) => registrable(hostToUnicode(d))))]);
      if (like) alerts.push({ code: "lookalike", severity: "high", detail: like });
    }
  }
  if (!isKnown) alerts.push({ code: "unknown_domain", severity: "info" });

  return { ok: true, url: url.href, host, hostUnicode, scheme, isKnown, alerts };
}
