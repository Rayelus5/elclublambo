import type { Content, Offer } from '@galaxy/sim';
import { useEffect, useRef, useState } from 'react';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { spriteDataUrl } from '../sprites';

// The level-up choice (GDD §5.1): 1 of 3. Number keys pick, the arrows move, Enter confirms; a click confirms at once.
// The world is frozen until the choice is made (the simulation waits), so Escape does nothing here.

function describe(content: Content, o: Offer): { name: string; icon: string; tag: string; text: string } {
  if (o.kind === 'heal') return { name: copy.arena.heal, icon: 'repair', tag: '', text: copy.arena.healDescription };
  const def = o.kind === 'weapon' ? content.weapons.find((w) => w.id === o.id) : content.passives.find((p) => p.id === o.id);
  return {
    name: def?.name ?? o.id,
    icon: def?.icon ?? 'repair',
    tag: o.level === 1 ? copy.arena.newItem : copy.arena.level(o.level),
    text: def?.description ?? '',
  };
}

export function LevelUp({ offer, content, onPick }: { offer: Offer[]; content: Content; onPick: (i: number) => void }) {
  const [sel, setSelState] = useState(0);
  const selRef = useRef(0);
  const setSel = (v: number | ((s: number) => number)) => {
    const next = typeof v === 'function' ? v(selRef.current) : v;
    selRef.current = next;
    setSelState(next);
  };
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= offer.length) {
        setSel(n - 1);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setSel((s) => (s + 1) % offer.length);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setSel((s) => (s + offer.length - 1) % offer.length);
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === ' ') {
        onPick(selRef.current);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offer, onPick]);

  return (
    <Dialog title={copy.arena.levelUp} onClose={() => {}} onEscape={() => {}} closeOnVeil={false} className="levelup">
      <p className="levelup-hint">{copy.arena.levelUpHint}</p>
      <div className="levelup-cards" role="radiogroup" aria-label={copy.arena.levelUp}>
        {offer.map((o, i) => {
          const d = describe(content, o);
          return (
            <button
              key={`${o.kind}:${o.id}`}
              type="button"
              role="radio"
              aria-checked={sel === i}
              className={`lip panel levelup-card${sel === i ? ' selected' : ''}${o.level === 1 && o.kind !== 'heal' ? ' fresh' : ''}`}
              onClick={() => onPick(i)}
              onFocus={() => setSel(i)}
              data-autofocus={i === 0 ? true : undefined}
            >
              <span className="levelup-key" aria-hidden="true">
                {i + 1}
              </span>
              <img src={spriteDataUrl(d.icon, 4)} alt="" width={48} height={48} />
              <b>{d.name}</b>
              {d.tag && <span className="levelup-tag">{d.tag}</span>}
              <span className="levelup-text">{d.text}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
