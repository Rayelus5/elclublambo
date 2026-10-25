import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Receipt } from "@/components/pay/receipt";
import { isChainId } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import { isLang, type Lang } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/i18n/routes";
import { readReceipt } from "@/lib/pay/inspect";
import { getProfileByAddress } from "@/lib/pay/queries";
import { safeError } from "@/lib/security/redact";

// Bloqueante a propósito (ver el layout de [lang]). La lectura de la cadena va dentro de <Suspense>.
export const instant = false;

type Props = PageProps<"/[lang]/pay/tx/[chainId]/[hash]">;

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** P3-R11: receipts are noindex. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, chainId, hash } = await params;
  if (!isLang(lang)) return {};
  return {
    title: getDictionary(lang).pay.receipt.metaTitle,
    alternates: alternatesFor("payReceipt", { chainId, hash }, lang),
    robots: { index: false, follow: false },
  };
}

async function ReceiptContent({ lang, chainId, hash }: { lang: Lang; chainId: string; hash: string }) {
  const chain = Number(chainId);
  if (!isChainId(chain) || !HASH_RE.test(hash)) notFound();
  const result = await readReceipt(chain, hash as `0x${string}`);
  let recipient = null;
  if (result.status === "ok") {
    try {
      recipient = await getProfileByAddress(result.to);
    } catch (e) {
      // The alias is a nicety: the receipt stands without it.
      console.error("[pay] receipt recipient lookup failed", safeError(e instanceof Error ? e.message : String(e)));
    }
  }
  return <Receipt lang={lang} chain={chain} hash={hash} result={result} recipient={recipient} />;
}

export default async function PayReceiptPage({ params }: Props) {
  const { lang, chainId, hash } = await params;
  if (!isLang(lang)) notFound();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-8 sm:py-12">
      <Suspense fallback={<div className="min-h-96" aria-hidden />}>
        <ReceiptContent lang={lang} chainId={chainId} hash={hash} />
      </Suspense>
    </main>
  );
}
