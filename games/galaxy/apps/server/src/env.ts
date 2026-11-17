import { z } from 'zod';

const origin = z
  .string()
  .url()
  .refine((s) => new URL(s).origin === s, 'must be a bare origin (scheme://host[:port])');

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  GALAXY_PUBLIC_ORIGINS: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(origin).min(1)),
  GALAXY_TOTP_KEY: z
    .string()
    .transform((s) => Buffer.from(s, 'base64'))
    .refine((b) => b.length === 32, 'GALAXY_TOTP_KEY must be 32 bytes in base64'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WEB_DIST: z.string().min(1).default('/app/web-dist'),
  TRUST_CF_IP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  STRIPE_SECRET_KEY: z.string().trim().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().trim().optional(),
  GALAXY_CANONICAL_ORIGIN: z.string().trim().optional(),
  GALAXY_LEGACY_REDIRECT_FROM: z.string().optional(),
});

/** The resource shop's Stripe keys (shop and lab plan, F4): all three, of one mode. */
export interface StripeEnv {
  /** A secret or restricted key (`sk_…`, `rk_…`). */
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
  mode: 'live' | 'test';
}

const SECRET = /^(?:sk|rk)_(live|test)_[A-Za-z0-9]+$/;
const PUBLISHABLE = /^pk_(live|test)_[A-Za-z0-9]+$/;
const WEBHOOK = /^whsec_[A-Za-z0-9+/=]+$/;

/**
 * The Stripe keys, when all three are there and agree; otherwise null and why (a code: never the keys). They are
 * optional: without them the shop stays closed and the game runs as before, so a missing key never breaks a deploy.
 */
export function stripeEnv(src: { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PUBLISHABLE_KEY?: string }): {
  stripe: StripeEnv | null;
  issue: 'stripe_env_incomplete' | null;
} {
  const secretKey = src.STRIPE_SECRET_KEY ?? '';
  const webhookSecret = src.STRIPE_WEBHOOK_SECRET ?? '';
  const publishableKey = src.STRIPE_PUBLISHABLE_KEY ?? '';
  if (!secretKey && !webhookSecret && !publishableKey) return { stripe: null, issue: null };
  const secretMode = SECRET.exec(secretKey)?.[1];
  const publishableMode = PUBLISHABLE.exec(publishableKey)?.[1];
  if (!secretMode || secretMode !== publishableMode || !WEBHOOK.test(webhookSecret)) return { stripe: null, issue: 'stripe_env_incomplete' };
  return { stripe: { secretKey, webhookSecret, publishableKey, mode: secretMode as StripeEnv['mode'] }, issue: null };
}

/** Why a domain value was ignored (logged at start, never fatal: a typo must not crash-loop the container). */
export type DomainIssue = 'canonical_origin_invalid' | 'legacy_host_invalid' | 'legacy_redirect_without_canonical';

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** A bare http(s) origin (scheme://host[:port], lowercase, nothing else), or null. */
function bareOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

/**
 * The game's own domain (galaxysurvivor.es plan, PR 1): its canonical origin and the old hosts whose page loads move to
 * it (the cutover switch). Both are optional and public; what does not fit is left out with its issue, never thrown.
 */
export function domainEnv(src: { GALAXY_CANONICAL_ORIGIN?: string; GALAXY_LEGACY_REDIRECT_FROM?: string }): {
  canonicalOrigin: string | null;
  legacyHosts: string[];
  issues: DomainIssue[];
} {
  const issues: DomainIssue[] = [];
  const raw = src.GALAXY_CANONICAL_ORIGIN?.trim() ?? '';
  const canonicalOrigin = raw ? bareOrigin(raw) : null;
  if (raw && !canonicalOrigin) issues.push('canonical_origin_invalid');
  const canonicalHost = canonicalOrigin ? new URL(canonicalOrigin).hostname : null;
  const entries = (src.GALAXY_LEGACY_REDIRECT_FROM ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  // A plain hostname only (no scheme, port or path), and never the canonical host itself (a redirect loop).
  const legacyHosts = entries.filter((h) => HOSTNAME.test(h) && h !== canonicalHost);
  if (legacyHosts.length < entries.length) issues.push('legacy_host_invalid');
  if (entries.length > 0 && !canonicalOrigin) issues.push('legacy_redirect_without_canonical');
  return { canonicalOrigin, legacyHosts: canonicalOrigin ? legacyHosts : [], issues };
}

export type Env = {
  DATABASE_URL: string;
  /**
   * Exact origins allowed on state-changing requests and on the sockets (GDD §18.2): GALAXY_PUBLIC_ORIGINS, plus the
   * canonical origin when there is one (after them, so the first stays the same).
   */
  GALAXY_PUBLIC_ORIGINS: string[];
  /** The game's own origin (`https://galaxysurvivor.es`), or null. Its `www.` host always redirects to it. */
  GALAXY_CANONICAL_ORIGIN: string | null;
  /** The cutover switch: old hosts (lowercase) whose page loads redirect to the canonical origin. Empty: off. */
  GALAXY_LEGACY_REDIRECT_FROM: string[];
  /** Domain values that were ignored, for the start log. */
  domainIssues: DomainIssue[];
  /** AES-256-GCM key for TOTP secrets at rest. */
  GALAXY_TOTP_KEY: Buffer;
  PORT: number;
  /** Directory with the Vite build, served under /galaxy/. */
  WEB_DIST: string;
  /** Trust CF-Connecting-IP (the container is only reachable through the tunnel or 127.0.0.1). */
  TRUST_CF_IP: boolean;
  /** The shop's Stripe keys, or null (closed shop); `stripeIssue` says why when they were there but do not agree. */
  stripe: StripeEnv | null;
  stripeIssue: 'stripe_env_incomplete' | null;
};

export function loadEnv(src: Record<string, string | undefined> = process.env): Env {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY, GALAXY_CANONICAL_ORIGIN, GALAXY_LEGACY_REDIRECT_FROM, ...rest } = schema.parse(src);
  const { stripe, issue } = stripeEnv({ STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY });
  const domain = domainEnv({ GALAXY_CANONICAL_ORIGIN, GALAXY_LEGACY_REDIRECT_FROM });
  // One list for the CSRF guard and every socket: the canonical origin joins the configured ones.
  const origins = domain.canonicalOrigin && !rest.GALAXY_PUBLIC_ORIGINS.includes(domain.canonicalOrigin) ? [...rest.GALAXY_PUBLIC_ORIGINS, domain.canonicalOrigin] : rest.GALAXY_PUBLIC_ORIGINS;
  return {
    ...rest,
    GALAXY_PUBLIC_ORIGINS: origins,
    GALAXY_CANONICAL_ORIGIN: domain.canonicalOrigin,
    GALAXY_LEGACY_REDIRECT_FROM: domain.legacyHosts,
    domainIssues: domain.issues,
    stripe,
    stripeIssue: issue,
  };
}
