import { useEffect, useId, useState } from 'react';
import { type AudioSettings, getSettings, onSettings, setSettings } from '../audio/mixer';
import { startMusic } from '../audio/music';
import { manualAim, resetRadio, setManualAim } from '../arena/settings';
import { copy } from '../copy/es';
import { sfx } from '../scanner/sfx';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// Ajustes (GDD §17.4; M8a, DESIGN_SYSTEM §8 tertricies): the music's and the effects' volume and a mute for all, the
// arena's aiming, and bringing back PERKINS's lines and the first steps. Everything lives in this browser.

const t = copy.settings;

function Volume({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  const id = useId();
  return (
    <div className="setting-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={0} max={100} step={5} value={Math.round(value * 100)} disabled={disabled} onChange={(e) => onChange(Number(e.target.value) / 100)} />
      <output htmlFor={id}>{t.percent(Math.round(value * 100))}</output>
    </div>
  );
}

export function SettingsScreen() {
  const [audio, setAudio] = useState<AudioSettings>(getSettings);
  const [aim, setAim] = useState(manualAim);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => onSettings(setAudio), []);
  return (
    <div className="screen-root missions-root">
      <div className="missions settings">
        <header className="collection-bar">
          <BackLink fallback="/">
            <Icon name="back" />
            <span>{t.back}</span>
          </BackLink>
          <h1>{t.title}</h1>
        </header>
        <section className="lip panel settings-group" aria-labelledby="settings-sound">
          <h2 id="settings-sound">{t.sound}</h2>
          <Volume
            label={t.music}
            value={audio.music}
            disabled={audio.muted}
            onChange={(music) => {
              setSettings({ music });
              if (music > 0) startMusic();
            }}
          />
          <Volume label={t.effects} value={audio.sfx} disabled={audio.muted} onChange={(v) => setSettings({ sfx: v })} />
          <label className="setting-check">
            <input type="checkbox" checked={audio.muted} onChange={(e) => setSettings({ muted: e.target.checked })} />
            <span>{t.muteAll}</span>
          </label>
          <button type="button" className="lip pill small" disabled={audio.muted || audio.sfx <= 0} onClick={() => sfx.clack()}>
            <Icon name="sound" />
            <span>{t.test}</span>
          </button>
        </section>
        <section className="lip panel settings-group" aria-labelledby="settings-arena">
          <h2 id="settings-arena">{t.arena}</h2>
          <label className="setting-check">
            <input
              type="checkbox"
              checked={aim}
              onChange={(e) => {
                setManualAim(e.target.checked);
                setAim(e.target.checked);
              }}
            />
            <span>{t.manualAim}</span>
          </label>
          <p className="panel-note">{t.manualAimHint}</p>
        </section>
        <section className="lip panel settings-group" aria-labelledby="settings-help">
          <h2 id="settings-help">{t.help}</h2>
          <div className="setting-actions">
            <button
              type="button"
              className="lip pill small"
              onClick={() => {
                resetRadio();
                setDone(t.radioDone);
              }}
            >
              {t.radio}
            </button>
            <button
              type="button"
              className="lip pill small"
              onClick={() => {
                try {
                  localStorage.removeItem('galaxy.firstSteps.hidden');
                } catch {
                  // Private windows: nothing kept anyway.
                }
                setDone(t.firstStepsDone);
              }}
            >
              {t.firstSteps}
            </button>
          </div>
          {done ? (
            <p className="panel-note" role="status">
              {done}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
