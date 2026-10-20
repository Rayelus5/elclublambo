import type { Metadata } from "next";
import { StartLanding } from "@/components/start/start-landing";
import { CANONICAL_ORIGIN, isProductionSite, siteOrigin } from "@/lib/start/site";

const TITLE = "ElClub. · El foro privado para quien se toma cripto en serio";
const DESCRIPTION =
  "Foro privado y asíncrono en Linea, solo con invitación: canales y chat, alphas con contrato verificado, bounties, propinas, tesorería común y sorteos verificables.";
const URL_START = `${CANONICAL_ORIGIN}/start`;

// Public, and indexable only in production (the rest of the forum never is). The OG/Twitter images come from opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: URL_START },
  robots: isProductionSite() ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website",
    url: URL_START,
    siteName: "ElClub.",
    locale: "es_ES",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function StartPage() {
  return <StartLanding />;
}
