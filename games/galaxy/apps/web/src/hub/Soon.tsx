import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

/**
 * The «En desarrollo» mark on a section a later milestone builds (DESIGN_SYSTEM §7, locked). `mini` is a padlock in
 * the corner (the words stay for screen readers), `tag` a padlock chip with the words, `text` just the words.
 */
export function Soon({ variant = 'mini' }: { variant?: 'mini' | 'tag' | 'text' }) {
  if (variant === 'text') return <span className="soon text">{copy.hub.soon}</span>;
  return (
    <span className={`soon ${variant}`}>
      <Icon name="lock" />
      <span className={variant === 'mini' ? 'sr-only' : undefined}>{copy.hub.soon}</span>
    </span>
  );
}
