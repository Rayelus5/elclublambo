import { ExternalLink } from "lucide-react";
import { shortAddress } from "@/lib/auth/wallet";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { DATE_LOCALE, fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import { easscanUrl } from "@/lib/vouches/eas";
import { kindRows, vouchKindKey } from "@/lib/vouches/kinds";
import type { VouchesSummary } from "@/lib/vouches/types";
import { RefreshButton } from "./refresh-button";

const LINK = "text-accent underline-offset-4 hover:underline";

/**
 * Received vouches of an address: distinct attesters per kind and, unless `compact`, the newest vouches with the attester
 * (Pay `@alias` or short address, never club membership, D15) and a link to each attestation on easscan. `refresh` adds
 * «Actualizar» per uid. Renders on the server or inside a client tree.
 */
export function VouchSummary({
  lang,
  t,
  summary,
  compact = false,
  refresh = false,
}: {
  lang: Lang;
  t: Dictionary["vouches"];
  summary: VouchesSummary;
  compact?: boolean;
  refresh?: boolean;
}) {
  if (summary.total === 0 && summary.items.length === 0) return <p className="text-base text-fg-muted">{t.summary.empty}</p>;

  const date = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeZone: "UTC" });
  const lookup = localizedPath(lang, "vouches");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted tabular-nums">{fill(t.summary.count, { n: summary.total })}</p>
      <ul aria-label={t.summary.countsLabel} className="flex flex-col gap-2">
        {kindRows(summary.counts).map((r) => (
          <li key={r.key} className="rounded-control border border-border px-3 py-2 text-base font-bold text-fg tabular-nums">
            {`${t.kinds[r.key]} · ${r.attesters}`}
          </li>
        ))}
      </ul>
      {compact ? null : (
        <ul aria-label={t.summary.listLabel} className="flex flex-col divide-y divide-border">
          {summary.items.map((v) => (
            <li key={v.uid} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-base text-fg">{t.kinds[vouchKindKey(v.kind)]}</span>
                <span className="text-sm text-fg-muted">
                  {t.summary.by}{" "}
                  {v.attesterAlias ? (
                    <a href={localizedPath(lang, "pay", { target: v.attesterAlias })} className={LINK}>
                      @{v.attesterAlias}
                    </a>
                  ) : (
                    <a href={`${lookup}?address=${v.attester}`} className={`font-mono break-all ${LINK}`}>
                      {shortAddress(v.attester)}
                    </a>
                  )}
                  {" · "}
                  <time dateTime={v.attestedAt}>{date.format(new Date(v.attestedAt))}</time>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2">
                <a
                  href={easscanUrl(v.chainId, v.uid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-11 items-center gap-1 text-sm ${LINK}`}
                >
                  {t.summary.viewOnEasscan}
                  <ExternalLink aria-hidden className="size-4" />
                </a>
                {refresh ? <RefreshButton uid={v.uid} t={t} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
