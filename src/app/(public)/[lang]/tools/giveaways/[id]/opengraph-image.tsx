import { ImageResponse } from "next/og";
import { isLang } from "@/lib/i18n";
import { ogFonts } from "@/lib/og/fonts";
import { ogContent } from "@/lib/public-giveaways/og";
import { getPublicGiveaway } from "@/lib/public-giveaways/queries";
import { colors } from "@/styles/tokens";

// The share card of a public giveaway. Language-neutral alt (a static export cannot depend on [lang]); the page's
// title and description carry the localized text. A missing giveaway renders the generic tool card, never a 500.
export const alt = "ElClub. Giveaway / Sorteo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang: rawLang, id } = await params;
  const lang = isLang(rawLang) ? rawLang : "es";
  let view = null;
  try {
    view = await getPublicGiveaway(id, null);
  } catch {
    // Generic card when the read fails.
  }
  const c = ogContent(view, lang);
  const fonts = await ogFonts();
  const titleSize = c.title.length > 60 ? 56 : c.title.length > 30 ? 72 : 92;
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
          {c.kicker}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div style={{ display: "flex", fontFamily: "Archivo", fontSize: titleSize, lineHeight: 1, letterSpacing: -3, overflow: "hidden", maxHeight: titleSize * 3 }}>
            {c.title}
          </div>
          {c.prizes ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40 }}>
              <span>{c.prizes}</span>
              <span style={{ color: colors.fgMuted }}>·</span>
              <span style={{ color: colors.fgMuted }}>{c.when}</span>
              {c.status ? <span style={{ color: colors.fgMuted }}>·</span> : null}
              {c.status ? <span style={{ color: colors.accent }}>{c.status}</span> : null}
            </div>
          ) : null}
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
          <span>ElClub.</span>
          <span style={{ color: colors.accent }}>{c.url}</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
