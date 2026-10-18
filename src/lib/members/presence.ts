// Client side of real-time presence (supabase/migrations/20261019000007_presence_realtime.sql, per device: 000008).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Heartbeat period; the server's online window is 75 s, so two beats can be lost before a member reads offline. */
export const BEAT_MS = 30_000;
/**
 * A tab that has not beaten for this long is considered gone (crashed or frozen). Background tabs may beat only once a
 * minute (browser timer throttling): 75 s, like the server's online window.
 */
const TAB_STALE_MS = 75_000;
const TABS_KEY = "elclub:presence-tabs";
const DEVICE_KEY = "elclub:presence-device";

/** This browser's presence device id (random, kept in localStorage; per visit when storage is blocked). */
let memoryDevice: string | null = null;
export function presenceDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && UUID_RE.test(stored)) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    memoryDevice ??= crypto.randomUUID();
    return memoryDevice;
  }
}

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
export function sendLeave(
  cfg: { url: string; anonKey: string; token: string | null; deviceId: string },
  fetchImpl: typeof fetch = fetch,
) {
  if (!cfg.token) return;
  void fetchImpl(`${cfg.url}/rest/v1/rpc/leave_presence`, {
    method: "POST",
    keepalive: true,
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_device: cfg.deviceId }),
  }).catch(() => undefined);
}

/** How long an "offline" waits before showing: a reload says goodbye and comes straight back, which must not blink. */
export const OFFLINE_GRACE_MS = 5_000;

/**
 * Applies presence events with a grace period for offline ones: online applies at once (and cancels a pending
 * offline for that member); offline applies after OFFLINE_GRACE_MS unless the member came back meanwhile.
 */
export function createPresenceApplier(apply: (memberId: string, online: boolean) => void) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    handle(ev: { memberId: string; online: boolean }) {
      const t = pending.get(ev.memberId);
      if (t) {
        clearTimeout(t);
        pending.delete(ev.memberId);
      }
      if (ev.online) {
        apply(ev.memberId, true);
        return;
      }
      pending.set(
        ev.memberId,
        setTimeout(() => {
          pending.delete(ev.memberId);
          apply(ev.memberId, false);
        }, OFFLINE_GRACE_MS),
      );
    },
    dispose() {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    },
  };
}
