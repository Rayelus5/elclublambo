"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { createPublicGiveawayAction } from "@/lib/public-giveaways/actions";
import { newPrizeRow, PrizeRows, prizeError, prizeInputs, type PrizeRow } from "./prize-rows";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const HOST_MAX = 60;
const MIN_MS = 10 * 60_000;
const MAX_MS = 90 * 86_400_000;
const FIELD =
  "min-h-11 w-full rounded-control border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger disabled:opacity-50 md:text-sm";

type Create = Dictionary["giveaways"]["create"];
type Errors = Dictionary["giveaways"]["errors"];
type FieldErrors = { title?: string; description?: string; closes?: string; host?: string; minTx?: string; allowlist?: string; prizes: Record<string, string> };

function FieldError({ id, children }: { id: string; children?: string }) {
  return children ? (
    <p id={id} role="alert" className="text-sm text-danger">
      {children}
    </p>
  ) : null;
}

/** Public giveaway creation: one column, labels always visible, errors under their field, requirements folded away. */
export function CreateForm({ lang, t, errors, chains }: { lang: Lang; t: Create; errors: Errors; chains: readonly ChainId[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [host, setHost] = useState("");
  const [minTx, setMinTx] = useState("0");
  const [allowlist, setAllowlist] = useState("");
  const [reqOpen, setReqOpen] = useState(false);
  const [rows, setRows] = useState<PrizeRow[]>(() => (chains.length > 0 ? [newPrizeRow(chains[0]!)] : []));
  const [fe, setFe] = useState<FieldErrors>({ prizes: {} });
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function validate(): { fe: FieldErrors; minTxCount: number; closeIso: string } | null {
    const next: FieldErrors = { prizes: {} };
    const tt = title.trim();
    if (tt.length < 1 || tt.length > TITLE_MAX) next.title = t.errTitle;
    if (description.trim().length > DESCRIPTION_MAX) next.description = t.errDescription;
    if (host.trim().length > HOST_MAX) next.host = t.errHost;
    const close = new Date(closesAt);
    const ahead = close.getTime() - Date.now();
    if (Number.isNaN(ahead) || ahead < MIN_MS || ahead > MAX_MS) next.closes = t.errClose;
    const n = /^\d+$/.test(minTx.trim()) ? Number(minTx.trim()) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 1000) next.minTx = t.errMinTx;
    for (const r of rows) {
      const e = prizeError(r, t);
      if (e) next.prizes[r.key] = e;
    }
    setFe(next);
    if (next.minTx) setReqOpen(true);
    const bad = next.title || next.description || next.closes || next.host || next.minTx || Object.keys(next.prizes).length > 0;
    if (bad) {
      // Focus the first field with an error once the invalid state has rendered.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return null;
    }
    return { fe: next, minTxCount: n, closeIso: close.toISOString() };
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const ok = validate();
    if (!ok) return;
    start(async () => {
      try {
        const r = await createPublicGiveawayAction({
          title: title.trim(),
          description: description.trim(),
          closesAt: ok.closeIso,
          hostName: host.trim(),
          minTxCount: ok.minTxCount,
          allowlist,
          prizes: prizeInputs(rows),
        });
        if (r.ok) return router.push(localizedPath(lang, "giveaway", { id: r.id }));
        if (r.error === "invalid_allowlist") {
          setReqOpen(true);
          setFe({ prizes: {}, allowlist: `${errors.invalid_allowlist} ${r.detail ?? ""}`.trim() });
          requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
          return;
        }
        setFormError(errors[r.error] ?? errors.unknown);
      } catch {
        setFormError(errors.unknown);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-control border border-accent p-3 text-sm">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        {t.free}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="pg-title" className="text-sm font-bold text-fg">
          {t.title}
        </label>
        <Input id="pg-title" autoComplete="off" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} aria-invalid={fe.title ? true : undefined} aria-describedby={fe.title ? "pg-title-err" : undefined} />
        <FieldError id="pg-title-err">{fe.title}</FieldError>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pg-description" className="text-sm font-bold text-fg">
          {t.description}
        </label>
        <textarea
          id="pg-description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          className={`${FIELD} resize-y py-2`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
          aria-invalid={fe.description ? true : undefined}
          aria-describedby={fe.description ? "pg-description-err" : undefined}
        />
        <FieldError id="pg-description-err">{fe.description}</FieldError>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pg-closes" className="text-sm font-bold text-fg">
          {t.closes}
        </label>
        <input
          id="pg-closes"
          type="datetime-local"
          className={FIELD}
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          disabled={pending}
          aria-invalid={fe.closes ? true : undefined}
          aria-describedby={fe.closes ? "pg-closes-hint pg-closes-err" : "pg-closes-hint"}
        />
        <p id="pg-closes-hint" className="text-[13px] text-fg-muted">
          {t.closesHint}
        </p>
        <FieldError id="pg-closes-err">{fe.closes}</FieldError>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pg-host" className="text-sm font-bold text-fg">
          {t.host}
        </label>
        <Input id="pg-host" autoComplete="off" maxLength={HOST_MAX} value={host} onChange={(e) => setHost(e.target.value)} disabled={pending} aria-invalid={fe.host ? true : undefined} aria-describedby={fe.host ? "pg-host-hint pg-host-err" : "pg-host-hint"} />
        <p id="pg-host-hint" className="text-[13px] text-fg-muted">
          {t.hostHint}
        </p>
        <FieldError id="pg-host-err">{fe.host}</FieldError>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="pg-prizes">
        <h2 id="pg-prizes" className="text-sm font-bold text-fg">
          {t.prizes}
        </h2>
        <p className="text-[13px] text-fg-muted">{t.prizesHint}</p>
        <PrizeRows rows={rows} onChange={setRows} chains={chains} t={t} errors={fe.prizes} disabled={pending} />
      </section>

      <details
        className="group rounded-panel border border-border"
        open={reqOpen}
        onToggle={(e) => setReqOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-panel px-3 text-sm font-bold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
          {t.requirements}
          <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="flex flex-col gap-4 px-3 pb-3">
          <p className="text-[13px] text-fg-muted">{t.requirementsHint}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor="pg-mintx" className="text-sm font-bold text-fg">
              {t.minTx}
            </label>
            <Input id="pg-mintx" inputMode="numeric" autoComplete="off" value={minTx} onChange={(e) => setMinTx(e.target.value)} disabled={pending} aria-invalid={fe.minTx ? true : undefined} aria-describedby={fe.minTx ? "pg-mintx-hint pg-mintx-err" : "pg-mintx-hint"} />
            <p id="pg-mintx-hint" className="text-[13px] text-fg-muted">
              {t.minTxHint}
            </p>
            <FieldError id="pg-mintx-err">{fe.minTx}</FieldError>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pg-allowlist" className="text-sm font-bold text-fg">
              {t.allowlist}
            </label>
            <textarea
              id="pg-allowlist"
              rows={4}
              spellCheck={false}
              autoComplete="off"
              className={`${FIELD} resize-y py-2 font-mono`}
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              disabled={pending}
              aria-invalid={fe.allowlist ? true : undefined}
              aria-describedby={fe.allowlist ? "pg-allowlist-hint pg-allowlist-err" : "pg-allowlist-hint"}
            />
            <p id="pg-allowlist-hint" className="text-[13px] text-fg-muted">
              {t.allowlistHint}
            </p>
            <FieldError id="pg-allowlist-err">{fe.allowlist}</FieldError>
          </div>
        </div>
      </details>

      <p className="text-sm text-fg-muted">{t.payNotice}</p>

      {formError ? (
        <p role="alert" className="rounded-control border border-danger p-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || chains.length === 0} className="w-full sm:w-auto sm:self-end">
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        {pending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
