"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleAlert, Info, Plus, Send, Trash2 } from "lucide-react";
import { CopyButton } from "@/components/pay/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assetId } from "@/lib/economy/assets";
import { chainForKey } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { encodeLines } from "@/lib/multisend/fragment";
import { buildPayUrl } from "@/lib/pay/link";
import { ADDRESS_RE } from "@/lib/pay/target";
import { formatAmount, parseAmount } from "@/lib/payments/amounts";
import { settle, type Participant } from "@/lib/split/settle";
import { decodeSplit, encodeSplit, MAX_NAME, MAX_PEOPLE, MAX_SPLIT_FRAGMENT, SPLIT_PREFIX, validTarget, type SplitState } from "@/lib/split/state";

type Row = { key: number; name: string; paid: string; target: string };

let nextKey = 0;
const newRow = (r: Partial<Omit<Row, "key">> = {}): Row => ({ key: nextKey++, name: "", paid: "", target: "", ...r });
const emptyRows = () => [newRow(), newRow()];

/** What a target field means: null when empty; "@Ana" -> "ana"; an address stays as typed. */
function cleanTarget(raw: string): string | null {
  const t = raw.trim().replace(/^@/, "");
  if (t === "") return null;
  return /^0x/i.test(t) ? t : t.toLowerCase();
}

const noSubscribe = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => "";

/** Navigates to a fragment on this page (fires hashchange, which the multisend form listens to). */
function goToHash(hash: string) {
  window.location.hash = hash;
}

/** Scrolls (and moves focus) to `el`, smoothly unless the user asked for reduced motion. */
function reveal(el: HTMLElement | null) {
  if (!el) return;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus?.({ preventScroll: true });
}

/**
 * «Repartir gastos» (P6-R4), the second section of the multisend page: who paid what, then who pays whom (greedy, at
 * most n − 1 transfers, exact to the micro-USDC). Pure client: the split lives only in the `#gastos=` fragment (kept up
 * to date with replaceState and shared with «Copiar enlace»), never on the server or in storage. A creditor with an
 * address or alias gets an ElClub Pay link per transfer; «Soy…» + «Enviar con envío múltiple» only PRELOADS the list
 * above through `#envio=`, where the usual review, confirmation and safeguards apply. Every button is outline: the
 * page's one fill stays «Enviar».
 */
export function SplitCalculator({ lang }: { lang: Lang }) {
  const dict = getDictionary(lang);
  const t = dict.multisend.split;
  const id = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<Row[]>(emptyRows);
  const [touched, setTouched] = useState(false);
  const [badLink, setBadLink] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [me, setMe] = useState("");
  const origin = useSyncExternalStore(noSubscribe, readOrigin, serverOrigin);
  const fmt = (units: bigint) => {
    const text = formatAmount(units, "USDC");
    return lang === "es" ? text : text.replace(",", ".");
  };

  // Restore from #gastos= on load and whenever a new split link is opened on this page. Our own replaceState does not
  // fire hashchange, and #envio= (the list above) is not ours to read.
  useEffect(() => {
    let live = true;
    const read = async () => {
      const hash = window.location.hash;
      if (!hash.startsWith(`#${SPLIT_PREFIX}`)) return;
      const state = await decodeSplit(hash);
      if (!live) return;
      if (state === null) {
        setBadLink(true);
        return;
      }
      setBadLink(false);
      setTouched(false);
      setMe("");
      setRows(state.people.map((p) => newRow({ name: p.n, paid: p.p, target: p.t ?? "" })));
      setShareUrl(window.location.href);
      if (sectionRef.current?.scrollIntoView) sectionRef.current.scrollIntoView({ block: "start" });
    };
    void read();
    window.addEventListener("hashchange", read);
    return () => {
      live = false;
      window.removeEventListener("hashchange", read);
    };
  }, []);

  const parsed = rows.map((r, i) => {
    const units = r.paid.trim() === "" ? 0n : parseAmount(r.paid, "USDC");
    const target = cleanTarget(r.target);
    return { row: r, label: r.name.trim() || fill(t.person, { n: i + 1 }), units, target, targetOk: target === null || validTarget(target) };
  });
  const hasErrors = parsed.some((p) => p.units === null || !p.targetOk);
  const total = parsed.reduce((s, p) => s + (p.units ?? 0n), 0n);
  const ready = !hasErrors && rows.length >= 2 && total > 0n;
  const participants: Participant[] = parsed.map((p) => ({ name: p.label, paid: p.units ?? 0n, target: p.target }));
  const transfers = ready ? settle(participants) : [];

  // The state that goes into the link: only a valid split (decodeSplit would reject anything else).
  const state: SplitState | null = hasErrors
    ? null
    : { v: 1, people: parsed.map((p) => ({ n: p.row.name, p: p.row.paid.trim() || "0", ...(p.target ? { t: p.target } : {}) })) };
  const stateKey = state ? JSON.stringify(state) : null;

  useEffect(() => {
    if (!touched || stateKey === null) return;
    let live = true;
    const timer = setTimeout(async () => {
      const encoded = await encodeSplit(JSON.parse(stateKey) as SplitState);
      if (!live || encoded.length > MAX_SPLIT_FRAGMENT) return;
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${search}#${SPLIT_PREFIX}${encoded}`);
      setShareUrl(window.location.href);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [touched, stateKey]);

  const edit = (key: number, patch: Partial<Omit<Row, "key">>) => {
    setTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const add = () => {
    setTouched(true);
    setRows((rs) => (rs.length >= MAX_PEOPLE ? rs : [...rs, newRow()]));
  };
  const remove = (key: number) => {
    setTouched(true);
    setRows((rs) => rs.filter((r) => r.key !== key));
    if (me === String(key)) setMe("");
  };

  const meIndex = rows.findIndex((r) => String(r.key) === me);
  const mine = meIndex < 0 ? [] : transfers.filter((x) => x.from === meIndex);
  const owes = mine.reduce((s, x) => s + x.amount, 0n);
  const lines = mine.filter((x) => ADDRESS_RE.test(participants[x.to]!.target ?? "")).map((x) => `${participants[x.to]!.target},${formatAmount(x.amount, "USDC").replace(",", ".")}`);
  const noAddress = [...new Set(mine.filter((x) => !ADDRESS_RE.test(participants[x.to]!.target ?? "")).map((x) => participants[x.to]!.name))];
  const payAsset = useMemo(() => assetId("USDC", chainForKey("base")), []);

  const sendWithMultisend = () => {
    try {
      goToHash(encodeLines(lines.join("\n")));
    } catch {
      return;
    }
    reveal(document.getElementById("envio"));
  };

  return (
    <section ref={sectionRef} id="repartir" aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-6 border-t border-border pt-8">
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-title`} className="font-display text-2xl font-bold text-fg">
          {t.title}
        </h2>
        <p className="text-base text-fg-muted">{t.lead}</p>
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span>{t.private}</span> <span>{dict.common.noCustody}</span>
          </span>
        </p>
      </div>

      {badLink ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.badLink}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-fg">{t.people}</h3>
        <ol className="flex flex-col gap-3">
          {parsed.map((p, i) => {
            const base = `${id}-${p.row.key}`;
            return (
              <li key={p.row.key}>
                <fieldset className="flex min-w-0 flex-col gap-3 rounded-panel border border-border p-4">
                  <legend className="px-1 text-sm font-bold text-fg">{fill(t.person, { n: i + 1 })}</legend>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={`${base}-name`} className="text-sm font-medium text-fg">
                        {t.name}
                      </label>
                      <Input id={`${base}-name`} value={p.row.name} maxLength={MAX_NAME} autoComplete="off" onChange={(e) => edit(p.row.key, { name: e.target.value })} />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={`${base}-paid`} className="text-sm font-medium text-fg">
                        {t.paid}
                      </label>
                      <Input
                        id={`${base}-paid`}
                        value={p.row.paid}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        className="tabular-nums"
                        aria-invalid={p.units === null || undefined}
                        aria-describedby={p.units === null ? `${base}-paid-error` : undefined}
                        onChange={(e) => edit(p.row.key, { paid: e.target.value })}
                      />
                    </div>
                  </div>
                  {p.units === null ? (
                    <p id={`${base}-paid-error`} className="text-sm text-danger">
                      {t.issues.amount}
                    </p>
                  ) : null}
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor={`${base}-target`} className="text-sm font-medium text-fg">
                      {t.target}
                    </label>
                    <Input
                      id={`${base}-target`}
                      value={p.row.target}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="font-mono"
                      aria-invalid={!p.targetOk || undefined}
                      aria-describedby={!p.targetOk ? `${base}-target-error` : undefined}
                      onChange={(e) => edit(p.row.key, { target: e.target.value })}
                    />
                    {!p.targetOk ? (
                      <p id={`${base}-target-error`} className="text-sm text-danger">
                        {t.issues.target}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    aria-label={fill(t.removeLabel, { name: p.label })}
                    disabled={rows.length <= 2}
                    onClick={() => remove(p.row.key)}
                  >
                    <Trash2 aria-hidden />
                    {t.remove}
                  </Button>
                </fieldset>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-1">
          <Button type="button" variant="outline" className="self-start" disabled={rows.length >= MAX_PEOPLE} onClick={add}>
            <Plus aria-hidden />
            {t.add}
          </Button>
          {rows.length >= MAX_PEOPLE ? <p className="text-sm text-fg-muted">{t.max}</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-3" aria-live="polite">
        <h3 id={`${id}-result`} className="text-sm font-bold text-fg">
          {t.result}
        </h3>
        {hasErrors ? (
          <p className="text-sm text-fg-muted">{t.fixErrors}</p>
        ) : !ready ? (
          <p className="text-sm text-fg-muted">{t.needTwo}</p>
        ) : (
          <>
            <p className="text-sm text-fg-muted tabular-nums">{fill(t.total, { total: fmt(total), n: rows.length })}</p>
            {transfers.length === 0 ? (
              <p className="text-base text-fg">{t.even}</p>
            ) : (
              <ol aria-labelledby={`${id}-result`} className="flex flex-col divide-y divide-border rounded-panel border border-border">
                {transfers.map((x, i) => {
                  const to = participants[x.to]!;
                  const amount = fmt(x.amount);
                  return (
                    <li key={`${x.from}-${x.to}-${i}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 text-base break-words text-fg tabular-nums">
                        {fill(t.pays, { from: participants[x.from]!.name, amount, to: to.name })}
                      </p>
                      {to.target ? (
                        <Button asChild variant="outline" className="self-start sm:self-auto">
                          <a
                            href={buildPayUrl(origin, lang, to.target, { amount: formatAmount(x.amount, "USDC"), asset: payAsset })}
                            aria-label={fill(t.payLinkLabel, { amount, to: to.name })}
                          >
                            {t.payLink}
                          </a>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="flex flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-1 sm:max-w-xs">
                <label htmlFor={`${id}-me`} className="text-sm font-medium text-fg">
                  {t.me}
                </label>
                <select
                  id={`${id}-me`}
                  value={meIndex < 0 ? "" : me}
                  onChange={(e) => setMe(e.target.value)}
                  className="min-h-11 w-full rounded-control border border-input bg-bg px-2.5 text-base text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <option value="">{t.meNone}</option>
                  {parsed.map((p) => (
                    <option key={p.row.key} value={String(p.row.key)}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {meIndex >= 0 && mine.length === 0 ? <p className="text-sm text-fg">{t.meNothing}</p> : null}
              {mine.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-fg tabular-nums">{fill(t.meOwes, { total: fmt(owes) })}</p>
                  {lines.length === 0 ? (
                    <p className="text-sm text-fg-muted">{t.noLines}</p>
                  ) : noAddress.length > 0 ? (
                    <p className="text-sm break-words text-fg-muted">{fill(t.noAddress, { names: noAddress.join(", ") })}</p>
                  ) : null}
                  <Button type="button" variant="outline" className="self-start" disabled={lines.length === 0} onClick={sendWithMultisend}>
                    <Send aria-hidden />
                    {t.sendMulti}
                  </Button>
                  <p className="text-sm text-fg-muted">{t.sendHint}</p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <CopyButton text={shareUrl ?? ""} label={t.copy} doneText={t.copied} failedText={t.copyFailed} disabled={shareUrl === null || hasErrors} />
    </section>
  );
}
