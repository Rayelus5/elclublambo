import { useEffect, useState } from 'react';
import { copy } from '../copy/es';
import { Icon } from './Icon';

// The time left until a moment (shop and lab plan, F5; season shop plan, PR 4): «Acaba en 2 d 5 h 03 min», ticking
// each second while it is on screen. The shop's offers and the season wear it, each with its own look.

/** The time left until `endsAt`, ticking each second; `className` gives it the look of where it sits. */
export function Countdown({ endsAt, className = 'shop-tag time' }: { endsAt: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = copy.shop;
  const left = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  const text = t.left(Math.floor(left / 86_400), Math.floor((left % 86_400) / 3600), Math.floor((left % 3600) / 60), left % 60);
  return (
    <span className={className}>
      <Icon name="comet" />
      <span>{t.endsIn(text)}</span>
    </span>
  );
}
