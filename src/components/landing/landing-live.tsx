import { offTools } from "@/components/public/tool-grid";
import type { Lang } from "@/lib/i18n/config";
import { Landing } from "./landing";

/** The landing with the switches (A-R16), from the tagged cache: part of the static shell, renewed by Administración. */
export async function LandingLive({ lang }: { lang: Lang }) {
  return <Landing lang={lang} off={await offTools()} />;
}
