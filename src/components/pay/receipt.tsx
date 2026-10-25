import { BadgeCheck, CircleAlert, ExternalLink, Hourglass } from "lucide-react";
import { ReceiptRefresh } from "@/components/pay/receipt-refresh";
import { NETWORKS, explorerAddress, explorerTx, type ChainId } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { DATE_LOCALE } from "@/lib/i18n/fill";
import { formatAmount } from "@/lib/payments/amounts";
import type { InspectResult } from "@/lib/pay/inspect";

type Props = {
  lang: Lang;
  chain: ChainId;
  hash: string;
  result: InspectResult;
  /** The recipient's public profile, when it has one. */
  recipient: { alias: string; displayName: string | null } | null;
};

function Address({ chain, address, alias }: { chain: ChainId; address: string; alias?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {alias ? <span className="font-bold text-fg">@{alias}</span> : null}
      <a
        href={explorerAddress(chain, address)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center break-all font-mono text-sm text-accent underline-offset-4 hover:underline"
      >
        {address}
      </a>
    </div>
  );
}

/** A transaction read from the chain. «Verified» only when it is final; everything else says pending or what went wrong. */
export function Receipt({ lang, chain, hash, result, recipient }: Props) {
  const t = getDictionary(lang).pay.receipt;
  const refreshing = result.status === "pending" || (result.status === "ok" && !result.final);

  return (
    <section aria-labelledby="receipt-title" className="flex flex-col gap-5 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <h1 id="receipt-title" className="font-display text-2xl font-bold text-fg sm:text-3xl">
        {t.title}
      </h1>
      {refreshing ? <ReceiptRefresh /> : null}

      {result.status === "error" ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.errors[result.code]}
        </p>
      ) : null}

      {refreshing ? (
        <div role="status" className="flex items-start gap-3 rounded-control border border-warning/70 p-3">
          <Hourglass aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-warning">{t.pending}</p>
            <p className="text-sm text-fg">{t.pendingText}</p>
          </div>
        </div>
      ) : null}

      {result.status === "ok" && result.final ? (
        <div className="flex items-start gap-3 rounded-control border border-success/70 p-3">
          <BadgeCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-success">{t.verified}</p>
            <p className="text-sm text-fg">{t.verifiedText}</p>
          </div>
        </div>
      ) : null}

      {result.status === "ok" ? (
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="text-sm text-fg-muted">{t.amount}</dt>
            <dd className="font-mono text-2xl font-bold text-fg">
              {(lang === "en" ? formatAmount(result.amount, result.token).replace(",", ".") : formatAmount(result.amount, result.token)) + " " + result.token}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t.from}</dt>
            <dd>
              <Address chain={chain} address={result.from} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t.to}</dt>
            <dd>
              <Address chain={chain} address={result.to} alias={recipient?.alias} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t.network}</dt>
            <dd className="text-fg">{NETWORKS[chain].name}</dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t.date}</dt>
            <dd className="text-fg">
              {new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(result.blockTimestamp * 1000))} UTC
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t.confirmations}</dt>
            <dd className="text-fg">{result.confirmations}</dd>
          </div>
        </dl>
      ) : null}

      <a
        href={explorerTx(chain, hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-bold text-accent underline-offset-4 hover:underline"
      >
        <ExternalLink aria-hidden className="size-4" />
        {t.explorer}
      </a>
      <p className="text-sm text-fg-muted">{t.noCustody}</p>
    </section>
  );
}
