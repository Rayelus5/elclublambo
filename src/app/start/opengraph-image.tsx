import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { colors } from "@/styles/tokens";

// The share card of /start, rendered at build time from the app's own fonts and tokens (no external origin).
export const alt = "ElClub. El foro privado para quien se toma cripto en serio. Solo con invitación, en Linea.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "src/assets/fonts", file));

export default async function Image() {
  const [archivo, dmSans, mono] = await Promise.all([
    font("archivo-expanded-black.ttf"),
    font("dm-sans-regular.ttf"),
    font("jetbrains-mono-regular.ttf"),
  ]);
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
          FORO PRIVADO · RED LINEA
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-end", fontFamily: "Archivo", fontSize: 220, lineHeight: 0.8, letterSpacing: -10 }}>
            ElClub
            <div style={{ width: 42, height: 42, marginLeft: 8, marginBottom: 4, background: colors.accent }} />
          </div>
          <div style={{ display: "flex", fontSize: 40, color: colors.fg }}>El foro privado para quien se toma cripto en serio.</div>
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
          <span>Solo con invitación. Sin ruido.</span>
          <span style={{ color: colors.accent }}>elclub.party/start</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Archivo", data: archivo, weight: 900, style: "normal" },
        { name: "DM Sans", data: dmSans, weight: 400, style: "normal" },
        { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
