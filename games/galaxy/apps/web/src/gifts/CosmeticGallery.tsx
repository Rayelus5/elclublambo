import type { CosmeticPiece, Gift } from '@galaxy/shared';
import { useId, useState } from 'react';
import { copy } from '../copy/es';
import { PieceArt } from '../cosmetics/PieceArt';
import { Segmented } from '../ui/Segmented';
import type { GiftCatalog } from './words';

// The style tab (mail v2, P3): every piece that can be given — avatars, frames, titles and skins, drawn — by piece, by
// where it comes from (rewards or the shop) and by name. The default ones are everyone's already: they are not here.

const g = copy.gifts;
const PIECES = ['skin', 'frame', 'avatar', 'title'] as const satisfies readonly CosmeticPiece[];
type Source = 'all' | 'reward' | 'shop';

interface Item {
  id: string;
  name: string;
  rarity: string;
  source: 'default' | 'reward' | 'shop';
  enabled: boolean;
}

function itemsOf(piece: CosmeticPiece, catalog: GiftCatalog): Item[] {
  const c = catalog.cosmetics;
  if (piece === 'title') return c.titles.map((t) => ({ id: t.text, name: t.text, rarity: t.rarity, source: t.source, enabled: t.enabled }));
  return piece === 'avatar' ? c.avatars : piece === 'frame' ? c.frames : c.skins;
}

export function CosmeticGallery({ catalog, disabled, onAdd }: { catalog: GiftCatalog; disabled: boolean; onAdd: (gift: Gift) => void }) {
  const ids = useId();
  const [piece, setPiece] = useState<CosmeticPiece>('skin');
  const [source, setSource] = useState<Source>('all');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const items = itemsOf(piece, catalog).filter((i) => i.enabled && i.source !== 'default' && (source === 'all' || i.source === source) && (!needle || i.name.toLowerCase().includes(needle)));
  return (
    <div className="gift-gallery">
      <div className="gift-filters">
        <Segmented<CosmeticPiece> aria-label={g.styleFilter} value={piece} options={PIECES.map((p) => ({ value: p, label: g.pieces[p] }))} onChange={setPiece} />
        <Segmented<Source> aria-label={g.sourceFilter} value={source} options={(['all', 'reward', 'shop'] as const).map((s) => ({ value: s, label: g.sources[s] }))} onChange={setSource} />
        <div className="gift-search">
          <label htmlFor={`${ids}-q`} className="sr-only">
            {g.search}
          </label>
          <input id={`${ids}-q`} type="search" placeholder={g.search} autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {items.length === 0 ? <p className="panel-note">{g.noPieces}</p> : null}
      <ul className={`gift-grid${piece === 'title' ? ' titles' : ''}`}>
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" className="gift-card" data-rarity={i.rarity} aria-label={g.addOf(g.cosmetic(piece, i.name))} disabled={disabled} onClick={() => onAdd({ kind: 'cosmetic', piece, id: i.id })}>
              <PieceArt piece={{ kind: piece, id: i.id }} size={48} />
              {piece === 'title' ? null : <b>{i.name}</b>}
              <small>
                <span>{copy.customize.rarity[i.rarity] ?? i.rarity}</span>
                {i.source === 'shop' ? <span className="gift-card-shop">{g.sourceOf.shop}</span> : null}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">{g.styleHint}</p>
    </div>
  );
}
