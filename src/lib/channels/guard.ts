// Real HTTP 404 for /c/<missing | hidden | malformed>, decided in the proxy before the page streams.
//
// With cacheComponents the page body lives under <Suspense>, so a notFound() thrown there arrives after the
// response headers (200) were sent. The Next docs recommend checking in Proxy and rewriting to a not-found route
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md, "Status codes").

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_PATH = /^\/c\/([^/]+)\/?$/;

/** A route no page matches: rewriting to it yields the app's 404 with a 404 status. */
export const NOT_FOUND_PATH = "/channel-not-found";

/** The `[channelId]` segment of `/c/<id>` (no deeper paths), or null for any other pathname. */
export function channelSegment(pathname: string): string | null {
  return CHANNEL_PATH.exec(pathname)?.[1] ?? null;
}

interface GuardClient {
  from: (table: "channels") => {
    select: (columns: "id") => {
      eq: (column: "id", value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc: (fn: "my_membership_status") => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * True when `pathname` is `/c/<id>` and the member cannot see such a channel. RLS makes "hidden" and "does not
 * exist" the same thing. Only active members get a 404: for everyone else the forum layout redirects
 * (/login, /banned, /no-access). Any error fails open (the page itself still calls notFound()).
 */
export async function isMissingChannel(supabase: GuardClient, pathname: string): Promise<boolean> {
  const segment = channelSegment(pathname);
  if (segment === null) return false;

  if (UUID.test(segment)) {
    const { data, error } = await supabase.from("channels").select("id").eq("id", segment.toLowerCase()).maybeSingle();
    if (error) return false;
    if (data) return false;
  }

  const { data: status, error } = await supabase.rpc("my_membership_status");
  return !error && status === "active";
}
