import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LANGS, isLang } from "@/lib/i18n/config";
import { PublicHeader } from "@/components/public/public-header";
import { PublicHeaderSlot } from "@/components/public/public-header-slot";
import { PublicFooter } from "@/components/public/public-footer";
import { introBootScript } from "@/lib/landing/intro";
import { siteOrigin } from "@/lib/start/site";

// El árbol público puede bloquear: es/en se prerrenderizan por completo (generateStaticParams) y un idioma desconocido debe
// responder 404 de verdad, no 200 en streaming.
export const instant = false;

// Sin `dynamicParams` (incompatible con cacheComponents): un idioma desconocido llega aquí y responde 404 con notFound().
export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

// Las URLs de las imágenes OG/Twitter de todas las páginas públicas (también la tarjeta de cada sorteo) se resuelven contra
// el origen del sitio, no contra el localhost que Next usa si falta (PRE corre `next start` detrás del túnel).
export function generateMetadata(): Metadata {
  return { metadataBase: siteOrigin() };
}

// Árbol público bilingüe: la raíz sigue siendo <html lang="es">; este contenedor marca el idioma de sus páginas (P2-R1).
export default async function PublicLangLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <div lang={lang} className="flex min-h-full flex-col">
      {/* Before anything paints: does the home's first-visit intro show? (sets html[data-intro], see IntroGate) */}
      <script dangerouslySetInnerHTML={{ __html: introBootScript() }} />
      <Suspense fallback={<PublicHeader lang={lang} session="pending" />}>
        <PublicHeaderSlot lang={lang} />
      </Suspense>
      {children}
      <PublicFooter lang={lang} />
    </div>
  );
}
