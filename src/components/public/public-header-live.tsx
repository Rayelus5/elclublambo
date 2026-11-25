"use client";

import type { Lang } from "@/lib/i18n/config";
import { usePublicSession } from "@/lib/auth/use-public-session";
import { PublicHeader } from "./public-header";

/** The public header with the session resolved in the browser: the layout reads nothing at request time. */
export function PublicHeaderLive({ lang }: { lang: Lang }) {
  return <PublicHeader lang={lang} session={usePublicSession()} />;
}
