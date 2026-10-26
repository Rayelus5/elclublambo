import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableContent } from "@/components/status/unavailable-content";
import { getDictionary } from "@/lib/i18n";
import { LANGS, isLang } from "@/lib/i18n/config";

// «Herramienta no disponible» (A-R8, A-R9): solo se llega por el rewrite 503 del proxy cuando un interruptor está apagado.
// Dinámica entera (ƒ): connection() antes de pintar nada, sin shell prerrenderizado, así que Next nunca cambia el
// `Cache-Control: no-store` del proxy por un `s-maxage`. `instant = false` permite bloquear así.
export const instant = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: PageProps<"/status/[lang]/unavailable">): Promise<Metadata> {
  const { lang } = await params;
  const t = getDictionary(isLang(lang) ? lang : "es").status;
  return { title: `${t.unavailableTitle} · ElClub.`, robots: { index: false, follow: false } };
}

export default async function Page({ params }: PageProps<"/status/[lang]/unavailable">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  await connection();
  return (
    <Suspense fallback={<div className="flex-1" aria-hidden />}>
      <UnavailableContent lang={lang} />
    </Suspense>
  );
}
