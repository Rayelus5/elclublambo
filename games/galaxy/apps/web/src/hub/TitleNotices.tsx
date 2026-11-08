import { useState } from 'react';
import { useNotices } from '../api/mail';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

const t = copy.mail;
const KEY = 'gs.notices.closed';

function closedIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    // Private mode or storage off: closed for this visit only.
  }
}

/**
 * The notices of the title screen (GDD §16.5; DESIGN_SYSTEM §8 vicies): the running ones above the logo, each in its
 * tone (an important one in Solar with the alert icon, information in Hielo) and closed for good in this browser.
 */
export function TitleNotices() {
  const notices = useNotices();
  const [closed, setClosed] = useState<string[]>(closedIds);
  const shown = (notices.data ?? []).filter((n) => !closed.includes(n.id));
  if (shown.length === 0) return null;
  return (
    <ul className="title-notices" aria-label={t.noticesLabel}>
      {shown.map((n) => (
        <li key={n.id} className={`notice title-notice ${n.tone}`}>
          <Icon name={n.tone === 'warning' ? 'alert' : 'comet'} />
          <span>{n.text}</span>
          <button
            type="button"
            className="title-notice-close"
            aria-label={t.closeNotice}
            title={t.closeNotice}
            onClick={() => {
              const next = [...closed, n.id];
              setClosed(next);
              remember(next);
            }}
          >
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  );
}
