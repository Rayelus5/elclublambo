"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/auth/wallet";
import { NetworkLogo } from "@/components/economy/network-logo";
import { ALPHA_ADDRESS_RE } from "@/lib/chat/model";
import { explorerAddress, isChainId, NETWORKS } from "@/lib/economy/networks";

/**
 * Header and chart of an Alpha thesis: a contract on its network, the explorer page and a DexScreener embed. A row on a
 * network the app no longer lists (old rows) shows only the address and the copy button: no chart, no link.
 */
export function AlphaCard({ address, chainId }: { address: string; chainId: number }) {
  const known = isChainId(chainId) ? chainId : null;
  const valid = ALPHA_ADDRESS_RE.test(address);
  const box = useRef<HTMLDivElement>(null);
  // The iframe is heavy (a whole third-party app): mount it only once the card is about to be seen.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!valid || known === null || inView || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [valid, known, inView]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!valid) return null;

  const short = shortAddress(address);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard unavailable (insecure context / denied): the address stays selectable on screen.
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-2 rounded-panel border border-border-strong bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-control border border-accent px-2 text-[13px] font-bold text-accent">
          <Sparkles aria-hidden className="size-3.5" />
          Alpha · Tesis
        </span>
        {known !== null ? <NetworkLogo chainId={known} size={18} withName className="text-[13px]" /> : null}
        {known !== null ? (
          <a
            href={explorerAddress(known, address)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-[13px] text-fg-muted underline underline-offset-2 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver en el explorador
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only"> (abre en una pestaña nueva)</span>
          </a>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-fg">{address}</code>
        <Button type="button" variant="ghost" size="icon" aria-label="Copiar dirección" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
        <span role="status" className="min-w-14 text-[13px] text-success">
          {copied ? "Copiada" : ""}
        </span>
      </div>

      {known !== null ? (
        <div ref={box} className="h-[360px] w-full overflow-hidden rounded-control border border-border bg-surface-2">
          {inView ? (
            <iframe
              src={`https://dexscreener.com/${NETWORKS[known].key}/${address}?embed=1&theme=dark&trades=0&info=0`}
              title={`Gráfico de ${short} en DexScreener`}
              sandbox="allow-scripts allow-same-origin allow-popups"
              loading="lazy"
              referrerPolicy="no-referrer"
              height={360}
              className="size-full border-0"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-fg-muted">Gráfico de {short}</div>
          )}
        </div>
      ) : null}

      <p className="text-[13px] text-fg-muted">Contenido de terceros. Investiga antes de invertir.</p>
    </div>
  );
}
