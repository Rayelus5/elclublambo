import { CircleAlert } from "lucide-react";
import { NETWORKS } from "@/lib/economy/networks";
import type { GasActionKey } from "@/lib/gas/actions";
import type { GasSnapshot, NetworkGas } from "@/lib/gas/read";
import { formatWei, usdFromWei } from "@/lib/gas/units";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill, localDecimal } from "@/lib/i18n/fill";

type T = ReturnType<typeof getDictionary>["gas"];
type CostRow = { action: GasActionKey; totalWei: string; noL1?: boolean };

const SECTION = "flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6";
const H2 = "font-display text-xl font-bold text-fg";
const DASH = "—";
/** ETH amounts of an L2 action are fractions of a cent: 8 decimals keep them readable. */
const ETH_DECIMALS = 8;

function Reason({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-fg-muted">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      {text}
    </p>
  );
}

/** One action's three amounts, as strings ready to show in `lang` (a decimal comma in Spanish). */
function amounts(totalWei: string, price: bigint | null, lang: Lang) {
  const wei = BigInt(totalWei);
  const d = (text: string) => localDecimal(text, lang);
  return { gwei: d(formatWei(wei, "gwei", 2)), eth: d(formatWei(wei, "eth", ETH_DECIMALS)), usd: price === null ? DASH : d(usdFromWei(wei, price)) };
}

/** Stacked cards on phones, a table from `sm` up: the same rows, never a horizontal scroll. */
function CostRows({ t, lang, rows, price, caption }: { t: T; lang: Lang; rows: CostRow[]; price: bigint | null; caption: string }) {
  const noL1 = (r: CostRow) => (r.noL1 ? <span className="block text-xs font-normal text-fg-muted">{t.noL1}</span> : null);
  return (
    <>
      <ul className="flex flex-col gap-3 sm:hidden" aria-label={caption}>
        {rows.map((r) => {
          const a = amounts(r.totalWei, price, lang);
          return (
            <li key={r.action} className="rounded-control border border-border p-3">
              <p className="font-medium text-fg">
                {t.actions[r.action]}
                {noL1(r)}
              </p>
              <dl className="mt-2 flex flex-col gap-1 text-sm">
                {(
                  [
                    [t.costGwei, a.gwei],
                    [t.costEth, a.eth],
                    [t.costUsd, a.usd],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd className="font-mono tabular-nums text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
      <table className="hidden w-full border-collapse text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-fg-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              {t.action}
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              {t.costGwei}
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              {t.costEth}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t.costUsd}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = amounts(r.totalWei, price, lang);
            return (
              <tr key={r.action} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-3 pr-3 text-left font-medium text-fg">
                  {t.actions[r.action]}
                  {noL1(r)}
                </th>
                <td className="py-3 pr-3 text-right font-mono tabular-nums text-fg">{a.gwei}</td>
                <td className="py-3 pr-3 text-right font-mono tabular-nums text-fg">{a.eth}</td>
                <td className="py-3 text-right font-mono tabular-nums text-fg">{a.usd}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function NetworkSection({ t, lang, net, price }: { t: T; lang: Lang; net: NetworkGas; price: bigint | null }) {
  const name = NETWORKS[net.chainId].name;
  const id = `gas-${net.chainId}`;
  return (
    <section aria-labelledby={id} className={SECTION}>
      <h2 id={id} className={H2}>
        {name}
      </h2>
      {net.status === "unavailable" ? (
        <>
          <p className="font-mono text-2xl text-fg-muted">{DASH}</p>
          <Reason text={t.networkUnavailable} />
        </>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            {fill(t.gasPrice, {
              total: localDecimal(formatWei(BigInt(net.baseFeeWei) + BigInt(net.priorityWei), "gwei", 4), lang),
              base: localDecimal(formatWei(BigInt(net.baseFeeWei), "gwei", 4), lang),
              tip: localDecimal(formatWei(BigInt(net.priorityWei), "gwei", 4), lang),
            })}
          </p>
          {net.l1Status === "unavailable" && <Reason text={t.l1Unavailable} />}
          <CostRows
            t={t}
            lang={lang}
            price={price}
            caption={fill(t.caption, { network: name })}
            rows={net.rows.map((r) => ({ action: r.action, totalWei: r.totalWei, noL1: r.l1Wei === null }))}
          />
        </>
      )}
    </section>
  );
}

/** The gas comparison: one section per network, then the Ethereum reference. Every amount is labelled approximate. */
export function GasTable({ lang, snapshot }: { lang: Lang; snapshot: GasSnapshot }) {
  const t = getDictionary(lang).gas;
  const price = snapshot.ethUsdE8 === null ? null : BigInt(snapshot.ethUsdE8);
  return (
    <div className="flex flex-col gap-6">
      {price === null && <Reason text={t.noPrice} />}
      {snapshot.networks.map((net) => (
        <NetworkSection key={net.chainId} t={t} lang={lang} net={net} price={price} />
      ))}
      <section aria-labelledby="gas-ethereum" className={SECTION}>
        <h2 id="gas-ethereum" className={H2}>
          {t.ethereumTitle}
        </h2>
        {snapshot.ethereum === null ? (
          <Reason text={t.ethereumUnavailable} />
        ) : (
          <>
            <p className="text-sm text-fg-muted">{fill(t.ethereumLead, { gwei: localDecimal(formatWei(BigInt(snapshot.ethereum.l1BaseFeeWei), "gwei", 4), lang) })}</p>
            <CostRows t={t} lang={lang} price={price} caption={fill(t.caption, { network: "Ethereum" })} rows={snapshot.ethereum.rows} />
          </>
        )}
      </section>
    </div>
  );
}
