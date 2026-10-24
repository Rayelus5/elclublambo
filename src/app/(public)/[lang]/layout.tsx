import { notFound } from "next/navigation";
import { LANGS, isLang } from "@/lib/i18n/config";

// El árbol público puede bloquear: es/en se prerrenderizan por completo (generateStaticParams) y un idioma desconocido debe
// responder 404 de verdad, no 200 en streaming.
export const instant = false;

// Sin `dynamicParams` (incompatible con cacheComponents): un idioma desconocido llega aquí y responde 404 con notFound().
export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

// Árbol público bilingüe: la raíz sigue siendo <html lang="es">; este contenedor marca el idioma de sus páginas (P2-R1).
export default async function PublicLangLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <div lang={lang} className="flex min-h-full flex-col">
      {children}
    </div>
  );
}
