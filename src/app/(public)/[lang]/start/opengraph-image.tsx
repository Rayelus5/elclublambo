import { ImageResponse } from "next/og";
import { getDictionary, isLang } from "@/lib/i18n";
import { ogFonts } from "@/lib/og/fonts";
import { colors } from "@/styles/tokens";

// The share card of /start, from the app's own fonts and tokens (no external origin). Language-neutral alt (a static
// export cannot depend on [lang]); the text drawn on the card follows the language.
export const alt = "ElClub. Private forum / Foro privado · Base · Arbitrum";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: rawLang } = await params;
  const lang = isLang(rawLang) ? rawLang : "es";
  const t = getDictionary(lang).start;
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
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-end", fontFamily: "Archivo", fontSize: 220, lineHeight: 0.8, letterSpacing: -10 }}>
            ElClub
            <div style={{ width: 42, height: 42, marginLeft: 8, marginBottom: 4, background: colors.accent }} />
          </div>
          <div style={{ display: "flex", fontSize: 40, color: colors.fg }}>{t.ogTagline}</div>
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
          <span>{t.ogFoot}</span>
          <span style={{ color: colors.accent }}>{lang === "en" ? "elclub.party/en/start" : "elclub.party/start"}</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}
