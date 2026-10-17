"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/auth/wallet";
import { ALPHA_ADDRESS_RE } from "@/lib/chat/model";

/** Header and chart of an Alpha thesis: a Linea contract, its explorer page and a DexScreener embed. */
export function AlphaCard({ address }: { address: string }) {
  const valid = ALPHA_ADDRESS_RE.test(address);
  const box = useRef<HTMLDivElement>(null);
  // The iframe is heavy (a whole third-party app): mount it only once the card is about to be seen.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!valid || inView || !el) return;
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
  }, [valid, inView]);

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
        <a
          href={`https://lineascan.build/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-[13px] text-fg-muted underline underline-offset-2 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ver en Lineascan
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only"> (abre en una pestaña nueva)</span>
        </a>
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

      <div ref={box} className="h-[360px] w-full overflow-hidden rounded-control border border-border bg-surface-2">
        {inView ? (
          <iframe
            src={`https://dexscreener.com/linea/${address}?embed=1&theme=dark&trades=0&info=0`}
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

      <p className="text-[13px] text-fg-muted">Contenido de terceros. Investiga antes de invertir.</p>
    </div>
  );
}
