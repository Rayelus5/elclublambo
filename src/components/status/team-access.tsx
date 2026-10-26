"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { hardReload } from "@/lib/navigation/hard-navigate";

// AppKit and wagmi only exist in the browser, and only someone who opens the panel without a session needs them.
const TeamAccessSign = dynamic(() => import("./team-access-sign").then((m) => m.TeamAccessSign), {
  ssr: false,
  loading: () => <div className="min-h-11" aria-hidden />,
});

type Phase = "closed" | "checking" | "sign" | "password" | "message" | "reloading";

/** What POST /api/team-access answered; anything unexpected (403, 503, a network failure) is "error". */
async function ask(password?: string): Promise<string> {
  try {
    const res = await fetch("/api/team-access", {
      method: "POST",
      cache: "no-store",
      ...(password === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }),
    });
    if (res.status === 429) return "rate_limited";
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
    return typeof body?.status === "string" ? body.status : "error";
  } catch {
    return "error";
  }
}

/**
 * «Acceso del equipo» on the maintenance page (A-R4, A-R17, A-R19). During maintenance the proxy answers 503 to server
 * actions and RSC refetches, so this panel only talks to Supabase from the browser (signInWithWallet) and to
 * /api/team-access, and lets the proxy decide again with a full reload.
 */
export function TeamAccess({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).status;
  const [phase, setPhase] = useState<Phase>("closed");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const panelId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === "password") inputRef.current?.focus();
  }, [phase]);

  /** Applies an answer of the route. `from` is the phase to stay in when the answer is an error. */
  function apply(status: string, from: Phase) {
    switch (status) {
      case "superadmin":
      case "granted":
      case "off": // the maintenance is over: the reload shows the site
        setPhase("reloading");
        hardReload();
        return;
      case "needs_password":
        setPhase("password");
        return;
      case "not_signed_in":
        setPhase("sign");
        return;
      case "not_listed":
        setError(t.notListed);
        setPhase("message");
        return;
      case "wrong_password":
      case "invalid":
        setError(t.wrongPassword);
        setPhase("password");
        return;
      case "rate_limited":
        setError(t.tooManyAttempts);
        setPhase(from === "password" ? "password" : "message");
        return;
      default:
        setError(t.teamError);
        setPhase(from === "password" ? "password" : "message");
    }
  }

  async function check() {
    setError(null);
    setPhase("checking");
    apply(await ask(), "checking");
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || password === "") return;
    setError(null);
    setBusy(true);
    try {
      apply(await ask(password), "password");
    } finally {
      setBusy(false);
    }
  }

  const open = phase !== "closed";

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) {
            setPhase("closed");
            setError(null);
            setPassword("");
          } else void check();
        }}
        className="-mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-control px-1 text-sm text-fg-muted underline decoration-border-strong underline-offset-4 transition-colors duration-150 outline-none hover:text-fg hover:decoration-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {t.teamAccess}
      </button>

      {open ? (
        <div id={panelId} role="region" aria-label={t.teamAccess} aria-busy={phase === "checking" || phase === "reloading" || busy} className="flex w-full max-w-sm flex-col gap-3 rounded-panel border border-border bg-surface p-4">
          {phase === "checking" || phase === "reloading" ? (
            <p className="min-h-11 content-center text-sm text-fg-muted">{t.checking}</p>
          ) : null}

          {phase === "sign" ? <TeamAccessSign lang={lang} onSignedIn={() => void check()} /> : null}

          {phase === "password" ? (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <label htmlFor={inputId} className="text-sm font-bold text-fg">
                {t.passwordLabel}
              </label>
              <Input
                ref={inputRef}
                id={inputId}
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error !== null || undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
              />
              <Button type="submit" disabled={busy} className="self-start">
                {busy ? t.checking : t.enter}
              </Button>
            </form>
          ) : null}

          {error ? (
            <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
