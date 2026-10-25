import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLang } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";

// Marcador de P3 (el recibo llega en una tarea posterior). Bloqueante a propósito (ver el layout de [lang]).
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[lang]/pay/tx/[chainId]/[hash]">): Promise<Metadata> {
  const { lang, chainId, hash } = await params;
  if (!isLang(lang)) return {};
  return {
    title: getDictionary(lang).pay.receipt.metaTitle,
    alternates: alternatesFor("payReceipt", { chainId, hash }, lang),
    robots: { index: false, follow: false },
  };
}

export default async function PayReceiptPage({ params }: PageProps<"/[lang]/pay/tx/[chainId]/[hash]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = getDictionary(lang).pay.receipt;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-bold text-fg">{t.title}</h1>
    </main>
  );
}
