import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLang } from "@/lib/i18n/config";

// Bloqueante a propósito (ver el layout): el idioma se lee antes de pintar.
export const instant = false;

// Marcador hasta el hub de herramientas (Task 10).
export default async function ToolsPage({ params }: PageProps<"/[lang]/tools">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDictionary(lang);
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold">{dict.common.nav.tools}</h1>
    </main>
  );
}
