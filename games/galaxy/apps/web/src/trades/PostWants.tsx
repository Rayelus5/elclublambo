import { sortTiers, type TradePostView, wantsSomething } from '@galaxy/shared';
import { phenomenonOptions, traitOptions } from '../collection/Filters';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

const b = copy.trades.board;
const nameOf = (options: [string, string][], v: string) => options.find(([k]) => k === v)?.[1] ?? v;

/** What a post is after, as chips: its rarities (in their colour), its traits, coins; or «Escucha propuestas». */
export function Wants({ w }: { w: TradePostView['wants'] }) {
  if (!wantsSomething(w)) return <p className="post-anything">{b.anything}</p>;
  return (
    <ul className="post-wants">
      {sortTiers(w.tiers).map((tier) => (
        <li key={tier} className="chip" data-tier={tier}>
          <i aria-hidden="true" />
          {copy.tiers[tier]}
        </li>
      ))}
      {w.type ? <li className="chip">{nameOf(traitOptions('galaxy_type'), w.type)}</li> : null}
      {w.palette ? <li className="chip">{nameOf(traitOptions('palette'), w.palette)}</li> : null}
      {w.phenomenon ? <li className="chip">{nameOf(phenomenonOptions(), w.phenomenon)}</li> : null}
      {w.coins ? (
        <li className="chip post-coins-ok">
          <Icon name="coin" />
          {b.acceptsCoins}
        </li>
      ) : null}
    </ul>
  );
}

