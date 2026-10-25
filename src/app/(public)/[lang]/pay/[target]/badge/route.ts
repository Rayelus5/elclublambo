import { getDictionary } from "@/lib/i18n";
import { isLang } from "@/lib/i18n/config";
import { getPublicProfileView } from "@/lib/pay/queries";
import { colors } from "@/styles/tokens";

const HEADERS = { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" };

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** The embeddable payment button (P3-R5): 240x56, the label and, when there is one, the recipient's @alias. */
function badge(label: string, alias: string | null): string {
  const text = escapeXml(label);
  const sub = alias ? `<text x="56" y="38" font-size="12" fill="${colors.fgMuted}">@${escapeXml(alias)}</text>` : "";
  const y = alias ? 22 : 33;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="56" viewBox="0 0 240 56" role="img" aria-label="${text}">` +
    `<rect x="0.5" y="0.5" width="239" height="55" rx="10" fill="${colors.surface}" stroke="${colors.border}"/>` +
    `<circle cx="28" cy="28" r="14" fill="${colors.accent}"/>` +
    `<path d="M22 28l4 4 8-8" fill="none" stroke="${colors.bg}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g font-family="system-ui,-apple-system,Segoe UI,sans-serif">` +
    `<text x="56" y="${y}" font-size="14" font-weight="700" fill="${colors.fg}">${text}</text>${sub}</g>` +
    `</svg>`
  );
}

/** GET the button image of `/pay/<alias>/badge`. An unknown alias, an address or a failed read gets the generic button, never a 500. */
export async function GET(_req: Request, ctx: { params: Promise<{ lang: string; target: string }> }): Promise<Response> {
  const { lang, target } = await ctx.params;
  const label = getDictionary(isLang(lang) ? lang : "es").pay.tool.badgeText;
  let alias: string | null = null;
  try {
    alias = (await getPublicProfileView(target))?.alias ?? null;
  } catch {
    alias = null;
  }
  return new Response(badge(label, alias), { headers: HEADERS });
}
