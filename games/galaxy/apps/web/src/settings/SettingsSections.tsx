import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTutorialUpdate } from '../api/tutorial';
import { type AudioSettings, getSettings, onSettings, setSettings } from '../audio/mixer';
import { startMusic } from '../audio/music';
import { resetRadio } from '../arena/settings';
import { copy } from '../copy/es';
import { sfx } from '../scanner/sfx';
import { CURSOR_COLORS, CURSOR_SIZES, type CursorSize, cursorSvg, readCursor, saveCursor } from '../ui/cursor';
import { Icon } from '../ui/Icon';

// The settings' sections (GDD §17.4; open beta), shared by the Ajustes screen and the run's pause so both are always
// the same: sound, the run (aiming), the game's cursor, and help (in a run it waits for the home menu, since its
// actions leave the run).

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

function Section({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className={`lip panel settings-group settings-${name}`} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function SoundSection() {
  const [audio, setAudio] = useState<AudioSettings>(getSettings);
  useEffect(() => onSettings(setAudio), []);
  return (
    <Section name="sound" title={t.sound}>
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
        <input type="checkbox" checked={audio.ui} disabled={audio.muted} onChange={(e) => setSettings({ ui: e.target.checked })} />
        <span>{t.uiSounds}</span>
      </label>
      <label className="setting-check">
        <input type="checkbox" checked={audio.muted} onChange={(e) => setSettings({ muted: e.target.checked })} />
        <span>{t.muteAll}</span>
      </label>
      <button type="button" className="lip pill small" disabled={audio.muted || audio.sfx <= 0} onClick={() => sfx.clack()}>
        <Icon name="sound" />
        <span>{t.test}</span>
      </button>
    </Section>
  );
}

/** The run's own settings: aiming with the mouse (the pause passes the run's live switch). */
export function ArenaSection({ aim, onAim }: { aim: boolean; onAim: (on: boolean) => void }) {
  return (
    <Section name="arena" title={t.arena}>
      <label className="setting-check">
        <input type="checkbox" checked={aim} onChange={(e) => onAim(e.target.checked)} />
        <span>{t.manualAim}</span>
      </label>
      <p className="panel-note">{t.manualAimHint}</p>
    </Section>
  );
}

/** The game's cursor: on or the system's, its size and its colour, applied at once. */
export function CursorSection() {
  const [cursor, setCursor] = useState(readCursor);
  const ids = useId();
  const change = (next: Parameters<typeof saveCursor>[0]) => setCursor(saveCursor(next));
  return (
    <Section name="cursor" title={t.cursor}>
      <label className="setting-check">
        <input type="checkbox" checked={cursor.on} onChange={(e) => change({ on: e.target.checked })} />
        <span>{t.cursorOn}</span>
      </label>
      <div className="setting-row cursor-row">
        <span id={`${ids}-size`}>{t.cursorSize}</span>
        <div className="segmented cursor-sizes" role="radiogroup" aria-labelledby={`${ids}-size`}>
          {(Object.keys(CURSOR_SIZES) as CursorSize[]).map((size) => (
            <button key={size} type="button" role="radio" aria-checked={cursor.size === size} disabled={!cursor.on} onClick={() => change({ size })}>
              {t.cursorSizes[size]}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row cursor-row">
        <span id={`${ids}-color`}>{t.cursorColor}</span>
        <div className="cursor-colors" role="radiogroup" aria-labelledby={`${ids}-color`}>
          {CURSOR_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={cursor.color === c.hex}
              aria-label={t.cursorColors[c.id]}
              title={t.cursorColors[c.id]}
              disabled={!cursor.on}
              className="cursor-swatch"
              onClick={() => change({ color: c.hex })}
            >
              <img src={cursorSvg('arrow', c.hex, 2)} alt="" width={32} height={32} />
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

/** Help from the home menu: PERKINS again, the first steps again, the tutorial again. */
export function HelpSection() {
  const [done, setDone] = useState<string | null>(null);
  const restart = useTutorialUpdate();
  const navigate = useNavigate();
  return (
    <Section name="help" title={t.help}>
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
        <button
          type="button"
          className="lip pill small"
          onClick={() =>
            restart.mutate(
              { action: 'restart' },
              {
                onSuccess: () => {
                  resetRadio();
                  navigate('/');
                },
              },
            )
          }
        >
          {t.tutorial}
        </button>
      </div>
      {done ? (
        <p className="panel-note" role="status">
          {done}
        </p>
      ) : null}
    </Section>
  );
}

/** Help during a run: the same actions, waiting for the home menu (they would leave the run). */
export function HelpSectionInRun() {
  return (
    <Section name="help" title={t.help}>
      <div className="setting-actions">
        {[t.radio, t.firstSteps, t.tutorial].map((label) => (
          <button key={label} type="button" className="lip pill small" disabled>
            {label}
          </button>
        ))}
      </div>
      <p className="panel-note">{t.helpInRun}</p>
    </Section>
  );
}
