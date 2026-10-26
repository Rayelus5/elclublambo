import { ImageResponse } from "next/og";
import { getDictionary, isLang } from "@/lib/i18n";
import { ogFonts } from "@/lib/og/fonts";
import { colors } from "@/styles/tokens";

// The landing's share card, per language, from the app's own fonts and tokens (no external origin). Language-neutral
// alt: a static export cannot depend on [lang]; the page's title and description carry the localized text.
export const alt = "ElClub. Herramientas cripto gratis y seguras / Free and safe crypto tools";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const t = getDictionary(isLang(raw) ? raw : "es").landing;
  const fonts = await ogFonts();
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
        <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 84, lineHeight: 0.95, letterSpacing: -3, maxWidth: 1000 }}>
          {t.hero.title}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${colors.borderStrong}`,
            paddingTop: 24,
            fontFamily: "JetBrains Mono",
            fontSize: 24,
            color: colors.fgMuted,
          }}
        >
          <span>{t.ogFooter}</span>
          <div style={{ display: "flex", alignItems: "flex-end", fontFamily: "Archivo", fontSize: 40, color: colors.fg }}>
            ElClub
            <div style={{ width: 9, height: 9, marginLeft: 3, marginBottom: 6, background: colors.accent }} />
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
