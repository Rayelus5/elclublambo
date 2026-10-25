import "server-only";
import { createHmac } from "node:crypto";
import { rpcErrorCode } from "@/lib/errors";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

/** Buckets limited by IP (limits live in public.ip_rate_limit_hit). */
export type IpBucket = "checker_web" | "api_free";

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

/** Anonymous limiter subject: 'ip:' + 32 hex of HMAC-SHA256(ip, key). Never the IP. 'ip:unknown' when IP or key is missing. */
export function ipSubject(ip: string | null, key: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY): string {
  if (!ip || !key) return "ip:unknown";
  return `ip:${createHmac("sha256", key).update(ip).digest("hex").slice(0, 32)}`;
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
