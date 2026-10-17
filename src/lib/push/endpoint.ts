// Anti-SSRF allowlist for push subscription endpoints. Exact mirror of public._valid_push_endpoint
// (supabase/migrations/20261017300001_notifications.sql); the shared case table lives in
// tests/fixtures/push-endpoints.json and is asserted against both implementations.
//
// https only, no userinfo, no port, no fragment; the host is an exact entry or a dot-boundary subdomain of
// *.notify.windows.com / *.push.apple.com. Case-insensitive, like the SQL `~*`.
const ENDPOINT_RE = new RegExp(
  "^https://(" +
    [
      "fcm\\.googleapis\\.com",
      "updates\\.push\\.services\\.mozilla\\.com",
      "web\\.push\\.apple\\.com",
      "([a-z0-9-]+\\.)+notify\\.windows\\.com",
      "([a-z0-9-]+\\.)+push\\.apple\\.com",
    ].join("|") +
    ")(/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$",
  "i",
);

export const MAX_ENDPOINT_LENGTH = 2048;

export function isAllowedPushEndpoint(url: string): boolean {
  return typeof url === "string" && url.length <= MAX_ENDPOINT_LENGTH && ENDPOINT_RE.test(url);
}
