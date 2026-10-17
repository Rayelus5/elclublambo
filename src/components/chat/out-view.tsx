import { ShieldAlert, TriangleAlert } from "lucide-react";
import { OutBackButton } from "@/components/chat/out-back-button";
import { buttonVariants } from "@/components/ui/button";
import { parseExternalUrl } from "@/lib/chat/links";
import { cn } from "@/lib/utils";

/** Fail closed: any punycode label warns, even one the decoder could not turn into Unicode. */
export function needsHomographWarning(host: string, unicodeHost: string): boolean {
  return /(^|\.)xn--/i.test(host) || unicodeHost !== host;
}

/** Interstitial shown before leaving the forum through a link that is not on the allowed list. */
export function OutView({ u }: { u: string | undefined }) {
  const target = parseExternalUrl(u);

  if (!target) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="out-title">
        <h1 id="out-title" className="font-display text-2xl font-extrabold">
          Enlace no válido
        </h1>
        <p role="alert" className="text-fg-muted">
          Solo se pueden abrir enlaces http(s) completos.
        </p>
        <div>
          <OutBackButton />
        </div>
      </section>
    );
  }

  const differs = needsHomographWarning(target.host, target.unicodeHost);
  const showUnicode = target.unicodeHost !== target.host;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="out-title">
      <div className="flex flex-col gap-3">
        <ShieldAlert aria-hidden className="size-8 text-warning" />
        <h1 id="out-title" className="font-display text-2xl font-extrabold">
          Vas a salir de El Club
        </h1>
      </div>

      <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-wide text-fg-muted uppercase">Dominio</span>
          <span className="font-mono text-base break-all text-fg">{target.host}</span>
          {showUnicode ? (
            <>
              <span className="text-xs font-bold tracking-wide text-fg-muted uppercase">Como se ve en Unicode</span>
              <span className="font-mono text-base break-all text-fg">{target.unicodeHost}</span>
            </>
          ) : null}
        </div>
        {differs ? (
          <p className="flex gap-2 rounded-control border border-warning p-3 text-sm text-fg">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              Este dominio usa caracteres que se parecen a otros (posible suplantación). Comprueba que es el sitio que esperas.
            </span>
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-wide text-fg-muted uppercase">Enlace completo</span>
          <span className="font-mono text-[13px] break-all text-fg">{target.href}</span>
        </div>
      </div>

      <p className="text-sm text-fg-muted">
        Nunca conectes tu wallet ni firmes nada en webs que no conoces. El staff jamás te pedirá tu frase semilla.
      </p>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <OutBackButton />
        <a
          href={target.href}
          rel="noopener noreferrer"
          target="_self"
          className={cn(buttonVariants({ variant: "default" }), "min-w-0 whitespace-normal break-all")}
        >
          Continuar a {target.host}
        </a>
      </div>
    </section>
  );
}
