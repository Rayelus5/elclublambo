import { ImageResponse } from "next/og";
import { getDictionary, isLang } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import { ogFonts } from "@/lib/og/fonts";
import { payTitleName } from "@/lib/pay/target";
import { siteOrigin } from "@/lib/start/site";
import { colors } from "@/styles/tokens";

// The share card of a pay link: the alias or the shortened address, from the URL alone (no database read, so it never
// fails on one). Language-neutral alt (a static export cannot depend on [lang]); the page's title carries the localized text.
export const alt = "ElClub Pay";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ lang: string; target: string }> }) {
  const { lang: rawLang, target } = await params;
  const lang = isLang(rawLang) ? rawLang : "es";
  const t = getDictionary(lang).pay.page;
  const name = payTitleName(target);
  const title = name ? fill(t.titleTo, { name }) : t.title;
  let url = "";
  try {
    url = siteOrigin().host + (name ? localizedPath(lang, "pay", { target }) : localizedPath(lang, "payTool"));
  } catch {
    // Footer without the URL rather than a 500.
  }
  const fonts = await ogFonts();
  const titleSize = title.length > 24 ? 64 : 92;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: colors.bg,
          backgroundImage: `linear-gradient(to right, ${colors.border} 1px, transparent 1px), linear-gradient(to bottom, ${colors.border} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          color: colors.fg,
          fontFamily: "DM Sans",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: "JetBrains Mono", fontSize: 24, color: colors.fgMuted }}>
          <div style={{ width: 14, height: 14, background: colors.accent }} />
          {t.ogKicker}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div style={{ display: "flex", fontFamily: "Archivo", fontSize: titleSize, lineHeight: 1, letterSpacing: -3, overflow: "hidden", maxHeight: titleSize * 3 }}>
            {title}
          </div>
          <div style={{ display: "flex", fontSize: 40, color: colors.fgMuted }}>{t.ogLine}</div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${colors.borderStrong}`,
            paddingTop: 24,
            fontFamily: "JetBrains Mono",
            fontSize: 24,
            color: colors.fgMuted,
          }}
        >
          <span>ElClub Pay</span>
          <span style={{ color: colors.accent }}>{url}</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
