import { MarketReveal } from "@/components/market/market-reveal";
import { TH, TIER_LG, TIER_MD, TIER_SM, TIER_XL } from "@/components/market/market-tiers";
import { toMarketRowData } from "@/lib/market/row-data";
import type { MarketCoin } from "@/lib/market/types";
import { cn } from "@/lib/utils";

const head = (
  <thead>
    <tr className="border-b border-border">
      <th scope="col" className={cn(TH, TIER_SM, "w-10 text-left")}>
        #
      </th>
      <th scope="col" className={cn(TH, "text-left")}>
        Cripto
      </th>
      <th scope="col" className={TH}>
        Precio
      </th>
      <th scope="col" className={cn(TH, TIER_XL)}>
        1 h
      </th>
      <th scope="col" className={cn(TH, TIER_SM)}>
        24 h
      </th>
      <th scope="col" className={cn(TH, TIER_MD)}>
        7 d
      </th>
      <th scope="col" className={cn(TH, TIER_MD)}>
        Capitalización
      </th>
      <th scope="col" className={cn(TH, TIER_XL)}>
        Volumen 24 h
      </th>
      <th scope="col" className={cn(TH, TIER_LG)}>
        7 días
      </th>
    </tr>
  </thead>
);

// T-006: the rows travel as plain data (MarketRowData) and the client draws the ones it shows; see market-reveal.tsx.
export function MarketTable({ coins }: { coins: MarketCoin[] }) {
  return (
    <div className="@container rounded-panel border border-border bg-surface" data-testid="market-table-panel">
      <MarketReveal caption="Criptos con mayor capitalización" head={head} rows={coins.map(toMarketRowData)} />
    </div>
  );
}
