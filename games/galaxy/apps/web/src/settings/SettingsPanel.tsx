import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { copy } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { AccessSection, ArenaSection, DisplaySection, HelpSection, HelpSectionInRun, SoundSection } from './SettingsSections';

// The settings (plan «escáner pro», part A; the owner: «un estilo y organización mucho más intuitiva, completa»): a
// column of tabs with icons and, beside it, the chosen tab's settings under its name and a line on what it holds.
// The same panel serves the Ajustes screen (the tab lives in the address) and the run's pause (the tab lives in the
// pause). Tabs after the WAI-ARIA pattern: only the chosen one takes Tab; the arrows, Home and End move and choose.

const t = copy.settings;

export const SETTINGS_TABS = ['sonido', 'pantalla', 'accesibilidad', 'incursion', 'ayuda'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const isSettingsTab = (v: string | null): v is SettingsTab => SETTINGS_TABS.includes(v as SettingsTab);

const TABS: Record<SettingsTab, { name: string; icon: IconName }> = {
  sonido: { name: t.sound, icon: 'sound' },
  pantalla: { name: t.display, icon: 'display' },
  accesibilidad: { name: t.access, icon: 'access' },
  incursion: { name: t.arena, icon: 'target' },
  ayuda: { name: t.help, icon: 'info' },
};

export function SettingsPanel({
  tab,
  onTab,
  inRun = false,
  aim,
  onAim,
}: {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  /** In a run's pause: help waits for the home menu. */
  inRun?: boolean;
  aim: boolean;
  onAim: (on: boolean) => void;
}) {
  const id = useId();
  const refs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  const choose = (next: SettingsTab) => {
    refs.current[next]?.focus();
    if (next !== tab) onTab(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = SETTINGS_TABS.indexOf(tab);
    const n = SETTINGS_TABS.length;
    let next: SettingsTab | undefined;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = SETTINGS_TABS[(at + 1) % n];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = SETTINGS_TABS[(at - 1 + n) % n];
    else if (e.key === 'Home') next = SETTINGS_TABS[0];
    else if (e.key === 'End') next = SETTINGS_TABS[n - 1];
    if (!next) return;
    e.preventDefault();
    choose(next);
  };

  let body: ReactNode;
  if (tab === 'sonido') body = <SoundSection inRun={inRun} />;
  else if (tab === 'pantalla') body = <DisplaySection inRun={inRun} />;
  else if (tab === 'accesibilidad') body = <AccessSection inRun={inRun} />;
  else if (tab === 'incursion') body = <ArenaSection aim={aim} onAim={onAim} />;
  else body = inRun ? <HelpSectionInRun /> : <HelpSection />;

  return (
    <div className={`lip panel settings-shell${inRun ? ' in-run' : ''}`}>
      <div className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t.sections}>
        {SETTINGS_TABS.map((key) => (
          <button
            key={key}
            ref={(el) => {
              refs.current[key] = el;
            }}
            id={`${id}-${key}-tab`}
            type="button"
            role="tab"
            className="settings-tab"
            aria-selected={key === tab}
            aria-controls={`${id}-panel`}
            tabIndex={key === tab ? 0 : -1}
            onClick={() => choose(key)}
            onKeyDown={onKeyDown}
          >
            <Icon name={TABS[key].icon} />
            <span>{TABS[key].name}</span>
          </button>
        ))}
      </div>
      <section className="settings-pane" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}-tab`} key={tab}>
        <header className="settings-pane-head">
          <h2>{TABS[tab].name}</h2>
          <p>{t.intro[tab]}</p>
        </header>
        <div className="setting-list">{body}</div>
      </section>
    </div>
  );
}
