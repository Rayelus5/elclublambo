"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChainId } from "@/lib/economy/networks";
import { rpcErrorMessage } from "@/lib/errors";
import type { GuideSlug } from "@/lib/guide/sections";
import { normalizeHandle } from "@/lib/members/handle";
import { completeWelcomeAction } from "@/lib/onboarding/actions";
import { safeNextPath } from "@/lib/onboarding/next-path";
import { setHandleAction } from "@/lib/profile/actions";

type Step = { title: string; guide: { slug: GuideSlug; label: string } | null };

const STEPS: Step[] = [
  { title: "Elige tu @handle", guide: null },
  { title: "Propinas y bounties", guide: { slug: "propinas", label: "Guía: Propinas" } },
  { title: "Donaciones y canales con candado", guide: { slug: "donaciones", label: "Guía: Donaciones y Mecenas" } },
  { title: "Redes y seguridad", guide: { slug: "redes", label: "Guía: Redes y seguridad" } },
];

const GUIDE_LINK =
  "inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export function WelcomeSteps({ initialHandle, next, chainIds }: { initialHandle: string | null; next: string; chainIds: readonly ChainId[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [savedHandle, setSavedHandle] = useState(initialHandle);
  const [input, setInput] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  // Move focus to the new step's heading (screen readers announce it); not on first render.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [index]);

  const parsed = normalizeHandle(input);
  const typed = input.trim() !== "";
  // "reservado" is shown at once; "formato inválido" only after leaving the field, so it does not nag mid-typing.
  const localError =
    typed && !parsed.ok && (parsed.error === "handle_reserved" || touched || input.trim().length > 20)
      ? rpcErrorMessage(parsed.error)
      : null;
  const error = serverError ?? localError;
  const canAdvance = savedHandle !== null || parsed.ok;

  function advance() {
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function submitHandle(e: FormEvent) {
    e.preventDefault();
    if (savedHandle !== null) return advance();
    if (!parsed.ok || pending) return;
    setServerError(null);
    start(async () => {
      const res = await setHandleAction(parsed.handle);
      if (res.ok) {
        setSavedHandle(res.handle);
        advance();
      } else {
        setServerError(res.error);
      }
    });
  }

  function finish() {
    if (pending) return;
    setFinishError(null);
    start(async () => {
      const res = await completeWelcomeAction();
      if (res.ok) router.replace(safeNextPath(next));
      else setFinishError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-small text-fg-muted">
          Paso {index + 1} de {STEPS.length}
        </p>
        <ol className="flex gap-2" aria-hidden>
          {STEPS.map((s, i) => (
            <li key={s.title} className={`h-1 flex-1 rounded-control ${i <= index ? "bg-accent" : "bg-border-strong"}`} />
          ))}
        </ol>
      </div>

      <section aria-labelledby="welcome-step-title" className="flex flex-col gap-5">
        <h2 id="welcome-step-title" ref={heading} tabIndex={-1} className="text-h2 outline-none">
          {step.title}
        </h2>

        {index === 0 && (
          <form onSubmit={submitHandle} className="flex flex-col gap-5" noValidate>
            {savedHandle !== null ? (
              <p className="flex items-center gap-3 rounded-panel border border-border bg-surface p-4">
                <span className="font-mono text-fg">@{savedHandle}</span>
                <span className="inline-flex items-center gap-1 text-small font-bold text-success">
                  <Check className="size-4" aria-hidden />
                  Hecho
                </span>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-fg-muted">
                  Así te verán y te mencionarán en El Club. Es obligatorio y puedes cambiarlo una vez cada 30 días.
                </p>
                <Label htmlFor="welcome-handle">@handle</Label>
                <Input
                  id="welcome-handle"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setServerError(null);
                  }}
                  onBlur={() => setTouched(true)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={20}
                  aria-invalid={error ? true : undefined}
                  aria-describedby="welcome-handle-help"
                  className="max-w-xs font-mono"
                />
                <p id="welcome-handle-help" className="text-small text-fg-muted">
                  3 a 20 caracteres: letras sin acentos, números o guion bajo.
                </p>
                {error && (
                  <p role="alert" className="text-small text-danger">
                    {error}
                  </p>
                )}
              </div>
            )}
            <div>
              <Button type="submit" disabled={!canAdvance || pending}>
                Siguiente
              </Button>
            </div>
          </form>
        )}

        {index === 1 && (
          <p className="text-fg-muted">
            Puedes premiar un mensaje o un perfil con una propina en ETH o USDC, en Base o Arbitrum, y abrir un bounty para
            pedir ayuda con una recompensa. Sin comisiones: el dinero va directo de tu wallet a la de la otra persona.
            ElClub. no custodia fondos.
          </p>
        )}
        {index === 2 && (
          <p className="text-fg-muted">
            Puedes donar al club en Base o Arbitrum, desde 1 USD, y recibes el rol Mecenas. Donar no da derechos económicos.
            Algunos canales llevan candado: piden haber donado una cantidad y verás si la cumples antes de entrar.
          </p>
        )}
        {index === 3 && (
          <div className="flex flex-col gap-4">
            <p className="text-fg-muted">
              El club mueve dinero en estas redes. Comprueba siempre la red y la dirección antes de firmar, y desconfía de
              quien te pida tu frase secreta.
            </p>
            <ul className="flex flex-wrap gap-3">
              {chainIds.map((id) => (
                <li key={id}>
                  <NetworkLogo chainId={id} withName />
                </li>
              ))}
            </ul>
          </div>
        )}

        {step.guide && (
          <div>
            <a href={`/guia/${step.guide.slug}`} target="_blank" rel="noopener" className={GUIDE_LINK}>
              {step.guide.label}
              <ExternalLink className="size-4" aria-hidden />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </div>
        )}

        {finishError && (
          <p role="alert" className="text-small text-danger">
            {finishError}
          </p>
        )}

        {index > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {last ? (
              <Button type="button" onClick={finish} disabled={pending}>
                Empezar
              </Button>
            ) : (
              <Button type="button" onClick={advance} disabled={pending}>
                Siguiente
              </Button>
            )}
            {!last && (
              <Button type="button" variant="ghost" onClick={finish} disabled={pending}>
                Saltar
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
