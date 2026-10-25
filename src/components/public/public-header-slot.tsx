import { getPublicSession } from "@/lib/auth/public-session";
import type { Lang } from "@/lib/i18n/config";
import { PublicHeader } from "./public-header";

/** Reads the session (cookies), so it must sit inside a <Suspense>; the rest of the layout stays static. */
export async function PublicHeaderSlot({ lang }: { lang: Lang }) {
  return <PublicHeader lang={lang} session={await getPublicSession()} />;
}
