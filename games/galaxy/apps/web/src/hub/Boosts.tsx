import { useBoosts } from '../api/boosts';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// The global multipliers running now (GDD §16.3; M6d-5, DESIGN_SYSTEM §8 quatervicies): one chip each, with its
// currency, its factor and when it ends. Nothing when none runs.

const t = copy.boosts;
const until = new Intl.DateTimeFormat('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

export function BoostChips() {
  const boosts = useBoosts().data?.boosts ?? [];
  if (boosts.length === 0) return null;
  return (
    <ul className="boost-chips" aria-label={t.title}>
      {boosts.map((b) => (
        <li key={b.id} className={`boost-chip ${b.currency}`}>
          <Icon name={b.currency === 'coins' ? 'coin' : b.currency === 'dust' ? 'dust' : b.currency === 'signal' ? 'radar' : 'station'} />
          <span>{t.chip(b.name, t.currencies[b.currency] ?? b.currency, b.factor, until.format(new Date(b.endsAt)))}</span>
        </li>
      ))}
    </ul>
  );
}
