/**
 * Log redaction (F5-R11). viem's HttpRequestError / RpcRequestError put the
 * full RPC URL in their message, and the Infura key lives in that URL's path.
 * Server code logs caught errors through `safeError(e)`, never the raw object.
 * Pure and dependency-free so a `.mjs` script can mirror the same rule.
 */

const MAX_CAUSES = 3;
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>`]+/gi;

/** `origin + "/***"`: drops userinfo, path, query and hash. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/^(https?|wss?):$/.test(u.protocol) || !u.host) return "(invalid url)";
    return `${u.protocol}//${u.host}/***`;
  } catch {
    return "(invalid url)";
  }
}

function redactText(text: string): string {
  return text.replace(URL_RE, (m) => {
    const r = redactUrl(m);
    return r === "(invalid url)" ? `${m.slice(0, m.indexOf("://") + 3)}***` : r;
  });
}

function messageOf(e: unknown): string | null {
  if (e === undefined || e === null) return null;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

/** A loggable, URL-redacted string for any thrown value. Never throws. */
export function safeError(e: unknown): string {
  try {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let cur: unknown = e;
    for (let depth = 0; depth <= MAX_CAUSES && cur !== undefined && cur !== null && !seen.has(cur); depth++) {
      seen.add(cur);
      let msg: string | null;
      try {
        msg = messageOf(cur);
      } catch {
        msg = "(unreadable error)";
      }
      if (msg !== null) parts.push(msg);
      try {
        cur = typeof cur === "object" ? (cur as { cause?: unknown }).cause : undefined;
      } catch {
        cur = undefined;
      }
    }
    if (parts.length === 0) return "unknown";
    return redactText(parts.join(" | cause: "));
  } catch {
    return "unknown";
  }
}
