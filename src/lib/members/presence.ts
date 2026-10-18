// Client side of real-time presence (supabase/migrations/20261019000007_presence_realtime.sql).

/** Heartbeat period; the server's online window is 75 s, so two beats can be lost before a member reads offline. */
export const BEAT_MS = 30_000;
/** A tab that has not beaten for this long is considered gone (crashed or frozen). */
const TAB_STALE_MS = 45_000;
const TABS_KEY = "elclub:presence-tabs";

type Tabs = Record<string, number>;

function readTabs(): Tabs {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Tabs) : {};
  } catch {
    return {};
  }
}

function writeTabs(tabs: Tabs) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // storage unavailable: every tab behaves as if it were the only one
  }
}

/** This tab is alive at `now` (called on every beat). */
export function rememberTab(tabId: string, now = Date.now()) {
  writeTabs({ ...readTabs(), [tabId]: now });
}

export function forgetTab(tabId: string) {
  const tabs = readTabs();
  delete tabs[tabId];
  writeTabs(tabs);
}

/** Another tab of this browser beat recently: closing this one must not announce the member as offline. */
export function otherLiveTabs(tabId: string, now = Date.now()): boolean {
  return Object.entries(readTabs()).some(([id, ts]) => id !== tabId && typeof ts === "number" && now - ts < TAB_STALE_MS);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A presence_changed payload, validated (it comes from the database, but never trust a wire format blindly). */
export function parsePresenceEvent(payload: unknown): { memberId: string; online: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const { member_id, online } = payload as { member_id?: unknown; online?: unknown };
  if (typeof member_id !== "string" || !UUID_RE.test(member_id) || typeof online !== "boolean") return null;
  return { memberId: member_id, online };
}

/**
 * The goodbye as the last tab closes: a keepalive request outlives the page (supabase-js offers no keepalive), with
 * the session token cached beforehand because nothing async can run during pagehide.
 */
export function sendLeave(cfg: { url: string; anonKey: string; token: string | null }, fetchImpl: typeof fetch = fetch) {
  if (!cfg.token) return;
  void fetchImpl(`${cfg.url}/rest/v1/rpc/leave_presence`, {
    method: "POST",
    keepalive: true,
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}
