import type { AccountSettings, SettingsView } from '@galaxy/shared';
import { useEffect } from 'react';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { startSync, useSyncStatus } from './sync';

// The settings on the account (plan «ajustes en la cuenta»): while someone is signed in, this browser and their
// account stay in step (settings/sync.ts); a new account (another player on this computer) starts again from its own.

/** Mounted once, over every screen. */
export function SettingsSync() {
  const id = useMe().data?.id;
  useEffect(() => {
    if (!id) return;
    return startSync({
      load: () => api<SettingsView>('/settings'),
      save: (s: AccountSettings) => api<SettingsView>('/settings', { method: 'PUT', body: s }),
    });
  }, [id]);
  return null;
}

const t = copy.settings.sync;

/** Ajustes says, quietly, where the settings are kept and how that stands. */
export function SettingsSyncNote() {
  const status = useSyncStatus();
  if (status === 'local') return null;
  return (
    <p className={`settings-sync is-${status}`} aria-live="polite">
      <Icon name={status === 'offline' ? 'alert' : status === 'saving' ? 'radar' : 'check'} />
      <span>{t[status]}</span>
    </p>
  );
}
