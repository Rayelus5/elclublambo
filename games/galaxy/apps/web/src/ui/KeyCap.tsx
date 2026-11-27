import { type Binding, keyCap } from '../settings/keybinds';
import { Icon } from './Icon';

/** The arrow keys draw the arrow icon on their cap, turned their way (the owner, 2026-11-27: icons, never «↑ ← →»). */
const ARROW_KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** What a key cap shows: an arrow key's icon, or the key's short name (`empty` when unbound). */
export function KeyCapLabel({ code, empty = '' }: { code: Binding; empty?: string }) {
  const dir = code ? ARROW_KEYS[code] : undefined;
  if (dir) return <Icon name="arrow" className={`ico key-arrow to-${dir}`} />;
  return <>{keyCap(code) || empty}</>;
}
