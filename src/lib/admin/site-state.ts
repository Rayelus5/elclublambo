// Lectura barata del estado del sitio para el proxy (A-R3). Sin `server-only` ni service role: solo la clave anónima.
// La caché es de módulo y best-effort: ahorra lecturas, nunca decide nada. Cualquier fallo abre el sitio (OPEN_STATE).
import { safeError } from "@/lib/security/redact";
import { serverSupabaseUrl } from "@/lib/supabase/urls";
import { OPEN_STATE, parseSiteState, type SiteState } from "./state";

const DEFAULT_TTL_MS = 5000;
const READ_TIMEOUT_MS = 1500;

type Entry = { at: number; promise: Promise<SiteState> };
let cache: Entry | null = null;

export function siteStateTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SITE_STATE_TTL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

export function invalidateSiteState(): void {
  cache = null;
}

async function read(fetcher: typeof fetch): Promise<SiteState> {
  try {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const res = await fetcher(`${serverSupabaseUrl()}/rest/v1/rpc/site_state`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`site_state ${res.status}`);
    return parseSiteState(await res.json());
  } catch (e) {
    console.error("[site-state] read failed", safeError(e));
    return OPEN_STATE;
  }
}

export function getSiteState(opts: { fetcher?: typeof fetch; now?: number } = {}): Promise<SiteState> {
  const now = opts.now ?? Date.now();
  const ttl = siteStateTtlMs();
  if (cache && ttl > 0 && now - cache.at < ttl) return cache.promise;
  // Con TTL 0 cada llamada lee: no se comparte nada (la entrada de caché solo sirve si TTL > 0).
  const entry: Entry = { at: now, promise: read(opts.fetcher ?? fetch) };
  cache = entry;
  return entry.promise;
}
