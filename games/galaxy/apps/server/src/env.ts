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

export type Env = {
  DATABASE_URL: string;
  /** Exact origins allowed on state-changing requests (GDD §18.2). */
  GALAXY_PUBLIC_ORIGINS: string[];
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
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY, ...rest } = schema.parse(src);
  const { stripe, issue } = stripeEnv({ STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY });
  return { ...rest, stripe, stripeIssue: issue };
}
