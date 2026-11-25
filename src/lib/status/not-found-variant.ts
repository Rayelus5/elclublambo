import { CLUB_BASE } from "@/lib/club/paths";

export type NotFoundVariant = "es" | "en" | "foro";

/** A-R14: the 404 variant of a URL (path, with or without query). `/en…` → en, the club → foro (Spanish), else es. */
export function notFoundVariant(path: string | null): NotFoundVariant {
  const pathname = (path ?? "").split(/[?#]/)[0] ?? "";
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "en") return "en";
  if (`/${first}` === CLUB_BASE) return "foro";
  return "es";
}

/**
 * The same choice as notFoundVariant, as an inline script that sets html[data-nf] while the browser parses the static
 * 404, before the first paint (globals.css shows the matching variant). Never throws: without it the Spanish one shows.
 */
export function notFoundBootScript(): string {
  const club = JSON.stringify(CLUB_BASE);
  return `(function(){try{var s=location.pathname.split("/")[1]||"";document.documentElement.dataset.nf=s==="en"?"en":"/"+s===${club}?"foro":"es"}catch(e){}})();`;
}
