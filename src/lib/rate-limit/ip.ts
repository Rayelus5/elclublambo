import "server-only";
import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { rpcErrorCode } from "@/lib/errors";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

/** Buckets limited by IP (limits live in public.ip_rate_limit_hit). */
export type IpBucket =
  | "checker_web"
  | "api_free"
  | "api_paid_attempt"
  | "vouch_refresh"
  | "approvals_scan"
  | "maintenance_password";

/**
 * The caller's IP (P4-R6): the header named by TRUSTED_IP_HEADER (cf-connecting-ip behind the PRE tunnel) or, by default,
 * the first x-forwarded-for entry (Vercel overwrites it). null when nothing usable is present.
 */
export function clientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  const trusted = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  const raw = trusted ? headers.get(trusted) : headers.get("x-forwarded-for");
  const first = raw?.split(",")[0]?.trim();
  return first ? first : null;
}

/**
 * The limiter's view of an IP: IPv4 as is; IPv6 reduced to its /64 prefix (one subscriber usually holds a whole /64, so
 * rotating the interface id must not yield a fresh counter), with IPv4-mapped addresses (::ffff:a.b.c.d) as their
 * IPv4. Brackets and a zone id are dropped. Anything unparseable is returned trimmed and lower-cased.
 */
export function normalizeIp(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  if (isIPv4(s) || !isIPv6(s)) return s;
  let text = s;
  // A dotted IPv4 tail becomes its two 16-bit groups.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((g) => parseInt(g, 16));
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Anonymous limiter subject: 'ip:' + 32 hex of HMAC-SHA256(normalizeIp(ip), key). Never the IP. 'ip:unknown' when IP or key is missing. */
export function ipSubject(ip: string | null, key: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY): string {
  if (!ip || !key) return "ip:unknown";
  return `ip:${createHmac("sha256", key).update(normalizeIp(ip)).digest("hex").slice(0, 32)}`;
}

/**
 * Charges one hit of `bucket` to the caller's IP subject (service role). "error" is any other failure: the API fails
 * closed on it, the web page fails open.
 */
export async function hitIpRateLimit(bucket: IpBucket, headers: Headers): Promise<"ok" | "rate_limited" | "error"> {
  try {
    const { error } = await createAdminClient().rpc("ip_rate_limit_hit", {
      p_subject: ipSubject(clientIp(headers)),
      p_bucket: bucket,
    });
    if (!error) return "ok";
    if (rpcErrorCode(error) === "rate_limited") return "rate_limited";
    console.error("[rate-limit] ip pre-hit failed", bucket, safeError(error.message));
    return "error";
  } catch (e) {
    console.error("[rate-limit] ip pre-hit failed", bucket, safeError(e));
    return "error";
  }
}
