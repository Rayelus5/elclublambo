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
  /** Close date, "Winners announced" (drawn) or the state of a cancelled / void giveaway; empty on the generic card. */
  when: string;
  /** The status label while it adds something (open, closed); empty otherwise and on the generic card. */
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
  const label = getDictionary(lang).giveaways.detail.status[view.status];
  // A cancelled or void giveaway will never close: its state is the whole line. Drawn: "Winners announced" says it all.
  const finished = view.status === "cancelled" || view.status === "void";
  return {
    kicker: t.kicker,
    title: view.title,
    prizes: fill(n === 1 ? t.prizeOne : t.prizeMany, { n }),
    when: finished ? label : view.status === "drawn" ? t.winners : fill(t.closes, { d: date }),
    status: finished || view.status === "drawn" ? "" : label,
    url: host + localizedPath(lang, "giveaway", { id: view.id }),
    alt: fill(t.alt, { title: view.title }),
  };
}
