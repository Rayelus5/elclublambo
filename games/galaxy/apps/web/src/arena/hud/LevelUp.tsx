import type { Content, Offer } from '@galaxy/sim';
import { useEffect, useRef, useState } from 'react';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { spriteDataUrl } from '../sprites';
import { CARD_GUARD_MS, cardKey, typing } from '../../ui/keys';
import { isAction, useKeyLabels } from '../../settings/keybinds';

// The level-up choice (GDD §5.1): 1 of 3. The pick keys (1, 2, 3 by default) take a card at once, as in a group run;
// the arrows move and the confirm key (Enter) takes the highlighted one; a click takes it at once. Space no longer
// picks: it was a dash key, and a dash pressed as the cards opened took one by mistake. For the same reason nothing
// counts in the first CARD_GUARD_MS. With a gamepad the D-pad or the left stick moves and A confirms (on the press,
// not while held). The world is frozen until the choice is made (the simulation waits), so Escape does nothing here.

export function describeOffer(content: Content, o: Offer): { name: string; icon: string; tag: string; text: string } {
  if (o.kind === 'heal') return { name: copy.arena.heal, icon: 'repair', tag: '', text: copy.arena.healDescription };
  if (o.kind === 'evolve') {
    const evo = content.weapons.find((w) => w.id === o.id);
    const base = content.weapons.find((w) => w.id === evo?.evolution?.from);
    return {
      name: evo?.name ?? o.id,
      icon: evo?.icon ?? 'repair',
      tag: copy.arena.evolution,
      text: base ? `${copy.arena.evolves(base.name)}. ${evo?.description ?? ''}` : (evo?.description ?? ''),
    };
  }
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
  const keys = useKeyLabels();
  const selRef = useRef(0);
  const setSel = (v: number | ((s: number) => number)) => {
    const next = typeof v === 'function' ? v(selRef.current) : v;
    selRef.current = next;
    setSelState(next);
  };
  // When the cards showed: nothing counts for a moment (a key or click meant for the run).
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [offer]);
  // Every way of taking a card goes through here (keys, the pad, a click), after the first moment.
  const pickRef = useRef<(i: number) => void>(() => {});
  useEffect(() => {
    pickRef.current = (i: number) => {
      if (Date.now() - shownAt.current >= CARD_GUARD_MS) onPick(i);
    };
  }, [onPick]);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (typing(e)) return;
      // Space never activates a card (the focused button would take it on its own): it is not a pick key.
      if (e.code === 'Space') {
        e.preventDefault();
        return;
      }
      // By the key's place (Digit1, Numpad1): with SHIFT held for a dash, the key would read «!».
      const n = cardKey(e.code);
      if (n >= 1 && n <= offer.length) {
        setSel(n - 1);
        pickRef.current(n - 1);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setSel((s) => (s + 1) % offer.length);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setSel((s) => (s + offer.length - 1) % offer.length);
        e.preventDefault();
      } else if (isAction('confirm', e.code) || e.key === 'Enter') {
        pickRef.current(selRef.current);
        e.preventDefault();
      }
    }
    // Space's own release would click the focused card: stopped too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [offer]);

  const count = offer.length;
  useEffect(() => {
    if (typeof navigator.getGamepads !== 'function' || typeof requestAnimationFrame !== 'function') return;
    const read = () => {
      const pad = navigator.getGamepads()[0];
      if (!pad) return null;
      const on = (i: number) => pad.buttons[i]?.pressed ?? false;
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      return { next: on(15) || on(13) || x > 0.5 || y > 0.5, prev: on(14) || on(12) || x < -0.5 || y < -0.5, pick: on(0) };
    };
    // What is already held when the dialog opens does not count.
    let was = read() ?? { next: false, prev: false, pick: false };
    let raf = 0;
    const poll = () => {
      const now = read();
      if (now) {
        if (now.next && !was.next) setSel((s) => (s + 1) % count);
        if (now.prev && !was.prev) setSel((s) => (s + count - 1) % count);
        if (now.pick && !was.pick) pickRef.current(selRef.current);
        was = now;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  return (
    <Dialog title={copy.arena.levelUp} onClose={() => {}} onEscape={() => {}} closeOnVeil={false} className="levelup">
      <p className="levelup-hint">{copy.arena.levelUpHint(keys)}</p>
      <div className="levelup-cards" role="radiogroup" aria-label={copy.arena.levelUp}>
        {offer.map((o, i) => {
          const d = describeOffer(content, o);
          return (
            <button
              key={`${o.kind}:${o.id}`}
              type="button"
              role="radio"
              aria-checked={sel === i}
              className={`lip panel levelup-card${sel === i ? ' selected' : ''}${o.kind === 'evolve' ? ' evolve' : o.level === 1 && o.kind !== 'heal' ? ' fresh' : ''}`}
              onClick={() => pickRef.current(i)}
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
