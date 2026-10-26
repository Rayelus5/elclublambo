import { Suspense } from "react";
import type { Metadata } from "next";
import { Archivo, DM_Sans, JetBrains_Mono } from "next/font/google";
import { IntroPathGuard } from "@/components/landing/intro-path-guard";
import { Providers } from "@/components/providers";
import { UI_ZOOM_BOOT } from "@/lib/ui-zoom";
import "./globals.css";

// Variable font sin `weight`: queda disponible todo el rango wght (800–900) y el eje wdth.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ElClub.",
  description: "Foro privado de la comunidad, solo con invitación.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${dmSans.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Tamaño de la interfaz elegido en el perfil (solo este dispositivo): se aplica antes del primer pintado. */}
        <script dangerouslySetInnerHTML={{ __html: UI_ZOOM_BOOT }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg font-body text-fg">
        <Providers>{children}</Providers>
        {/* Clears the home intro's html[data-intro] on any other path. In Suspense: usePathname suspends while
            prerendering routes with params not known at build time (cacheComponents). */}
        <Suspense fallback={null}>
          <IntroPathGuard />
        </Suspense>
      </body>
    </html>
  );
}
