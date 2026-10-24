import { getDictionary, type Lang } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import { siteOrigin } from "@/lib/start/site";
import type { PublicGiveawayView } from "./types";

export interface OgContent {
  kicker: string;
  title: string;
  /** "N prizes"; empty on the generic card. */
  prizes: string;
  /** Close date or "Winners announced"; empty on the generic card. */
  when: string;
  status: string;
  /** Host + public path, no scheme. */
  url: string;
  alt: string;
}

/** The texts of a giveaway's share card. Never includes the host's address (only title, counts and dates). */
export function ogContent(view: PublicGiveawayView | null, lang: Lang): OgContent {
  const t = getDictionary(lang).giveaways.og;
  const host = siteOrigin().host;
  if (!view) {
    return {
      kicker: t.kicker,
      title: t.genericTitle,
      prizes: "",
      when: "",
      status: "",
      url: host + localizedPath(lang, "giveaways"),
      alt: t.genericAlt,
    };
  }
  const n = view.prizes.length;
  const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(view.closesAt));
  return {
    kicker: t.kicker,
    title: view.title,
    prizes: fill(n === 1 ? t.prizeOne : t.prizeMany, { n }),
    when: view.status === "drawn" ? t.winners : fill(t.closes, { d: date }),
    status: getDictionary(lang).giveaways.detail.status[view.status],
    url: host + localizedPath(lang, "giveaway", { id: view.id }),
    alt: fill(t.alt, { title: view.title }),
  };
}
