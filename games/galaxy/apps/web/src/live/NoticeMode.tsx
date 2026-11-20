import { NOTICE_MODES, type NoticeMode } from '@galaxy/shared';
import { useId } from 'react';
import { useFriends, useSocialPrefs } from '../api/friends';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';

// How notices reach me (real-time notices plan, 2026-11-12): «Con sonido», «Sin sonido» or «Silencio», saved on the
// account at once. It sits on my profile and in the friends' privacy tab.

const t = copy.notices;

export function NoticeModeField({ hint = false }: { hint?: boolean }) {
  const friends = useFriends();
  const prefs = useSocialPrefs();
  const label = useId();
  const v = friends.data;
  if (!v) return null;
  return (
    <div className="notice-mode">
      <span className="notice-mode-label" id={label}>
        <Icon name="bell" />
        {t.mode}
      </span>
      <Select<NoticeMode>
        aria-labelledby={label}
        size="sm"
        value={v.prefs.notices}
        disabled={prefs.isPending}
        options={NOTICE_MODES.map((m) => ({ value: m, label: t.modes[m] }))}
        onChange={(notices) => prefs.mutate({ ...v.prefs, notices })}
      />
      {hint ? <p className="notice-mode-hint">{t.modeHint}</p> : null}
      {prefs.isError ? (
        <p className="field-error" role="alert">
          {errorText(prefs.error, copy.errors)}
        </p>
      ) : null}
    </div>
  );
}
