import { offTools } from "@/components/public/tool-grid";
import type { Lang } from "@/lib/i18n/config";
import { Landing } from "./landing";

/** The landing with the switches read at request time (A-R16): mounted inside Suspense, after `connection()`. */
export async function LandingLive({ lang }: { lang: Lang }) {
  return <Landing lang={lang} off={await offTools()} />;
}
