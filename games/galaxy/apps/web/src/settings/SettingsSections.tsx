import { NOTICE_MODES, type NoticeMode } from '@galaxy/shared';
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useFriends, useSocialPrefs } from '../api/friends';
import { useTutorialUpdate } from '../api/tutorial';
import { type AudioSettings, getSettings, onSettings, setSettings } from '../audio/mixer';
import { startMusic } from '../audio/music';
import { resetRadio } from '../arena/settings';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { sfx } from '../scanner/sfx';
import { CURSOR_COLORS, CURSOR_SIZES, type CursorSize, cursorSvg, readCursor, saveCursor } from '../ui/cursor';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { type ColorVisionMode, PALETTES } from '../a11y/color-vision';
import { ELEMENT_GLYPH } from '../arena/stage/palette';
import { COLOR_VISIONS, type Motion, MOTIONS, setPrefs, systemReduced, usePrefs } from './prefs';
import { SettingRow } from './SettingRow';

// What each tab of the settings holds (GDD §17.4; open beta; redesigned in the «escáner pro» plan, part A), shared by
// the Ajustes screen and the run's pause so both are always the same: sound, display, accessibility, the run, and help
// (in a run it waits for the home menu, since its actions leave the run). Each one is a list of rows (SettingRow) with
// the game's own controls.

const t = copy.settings;

function Volume({ label, value, onChange, off }: { label: string; value: number; onChange: (v: number) => void; off: boolean }) {
  return (
    <SettingRow label={label} layout="wide" off={off}>
      {(ids) => (
        <Slider aria-labelledby={ids.label} value={Math.round(value * 100)} step={5} disabled={off} valueText={t.percent} onChange={(v) => onChange(v / 100)} />
      )}
    </SettingRow>
  );
}

/** How notices reach me (the account's own setting, also on the profile): shown once the friends' view is here. */
function NoticesRow() {
  const friends = useFriends();
  const prefs = useSocialPrefs();
  const v = friends.data;
  if (!v) return null;
  return (
    <SettingRow label={copy.notices.mode} hint={copy.notices.modeHint}>
      {(ids) => (
        <div className="setting-select">
          <Select<NoticeMode>
            aria-labelledby={ids.label}
            aria-describedby={ids.hint}
            value={v.prefs.notices}
            disabled={prefs.isPending}
            options={NOTICE_MODES.map((m) => ({ value: m, label: copy.notices.modes[m] }))}
            onChange={(notices) => prefs.mutate({ ...v.prefs, notices })}
          />
          {prefs.isError ? (
            <p className="field-error" role="alert">
              {errorText(prefs.error, copy.errors)}
            </p>
          ) : null}
        </div>
      )}
    </SettingRow>
  );
}

/** Sound; `inRun` leaves out the account's notices mode, so the pause fits a 1280×720 screen. */
export function SoundSection({ inRun = false }: { inRun?: boolean }) {
  const [audio, setAudio] = useState<AudioSettings>(getSettings);
  useEffect(() => onSettings(setAudio), []);
  return (
    <>
      <Volume
        label={t.music}
        value={audio.music}
        off={audio.muted}
        onChange={(music) => {
          setSettings({ music });
          if (music > 0) startMusic();
        }}
      />
      <Volume label={t.effects} value={audio.sfx} off={audio.muted} onChange={(v) => setSettings({ sfx: v })} />
      <SettingRow label={t.uiSounds} hint={t.uiSoundsHint} off={audio.muted}>
        {(ids) => <Switch aria-labelledby={ids.label} aria-describedby={ids.hint} checked={audio.ui} disabled={audio.muted} onChange={(ui) => setSettings({ ui })} />}
      </SettingRow>
      <SettingRow label={t.muteAll} hint={t.muteAllHint}>
        {(ids) => <Switch aria-labelledby={ids.label} aria-describedby={ids.hint} checked={audio.muted} onChange={(muted) => setSettings({ muted })} />}
      </SettingRow>
      <SettingRow label={t.testTitle} hint={t.testHint} off={audio.muted || audio.sfx <= 0}>
        {() => (
          <button type="button" className="lip pill small setting-button" disabled={audio.muted || audio.sfx <= 0} onClick={() => sfx.clack()}>
            <Icon name="sound" />
            <span>{t.test}</span>
          </button>
        )}
      </SettingRow>
      {inRun ? null : <NoticesRow />}
    </>
  );
}

/** The pro scanner (home menu only) and the game's cursor: on or the system's, its size and its colour, at once. */
export function DisplaySection({ inRun = false }: { inRun?: boolean }) {
  const [cursor, setCursor] = useState(readCursor);
  const scannerPro = usePrefs((p) => p.scannerPro);
  const change = (next: Parameters<typeof saveCursor>[0]) => setCursor(saveCursor(next));
  return (
    <>
      {inRun ? null : (
        <SettingRow label={t.scannerPro} hint={t.scannerProHint}>
          {(ids) => <Switch aria-labelledby={ids.label} aria-describedby={ids.hint} checked={scannerPro} onChange={(on) => setPrefs({ scannerPro: on })} />}
        </SettingRow>
      )}
      <SettingRow label={t.cursorOn} hint={t.cursorOnHint}>
        {(ids) => <Switch aria-labelledby={ids.label} aria-describedby={ids.hint} checked={cursor.on} onChange={(on) => change({ on })} />}
      </SettingRow>
      <SettingRow label={t.cursorSize} off={!cursor.on}>
        {(ids) => (
          <Segmented<CursorSize>
            aria-labelledby={ids.label}
            className="cursor-sizes"
            value={cursor.size}
            disabled={!cursor.on}
            options={(Object.keys(CURSOR_SIZES) as CursorSize[]).map((size) => ({ value: size, label: t.cursorSizes[size] }))}
            onChange={(size) => change({ size })}
          />
        )}
      </SettingRow>
      <SettingRow label={t.cursorColor} layout="stack" off={!cursor.on}>
        {(ids) => (
          <div className="cursor-colors" role="radiogroup" aria-labelledby={ids.label}>
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
                <img src={cursorSvg('default', c.hex, 2)} alt="" width={36} height={36} />
              </button>
            ))}
          </div>
        )}
      </SettingRow>
    </>
  );
}

function subscribeSystem(onChange: () => void): () => void {
  let m: MediaQueryList | null = null;
  try {
    m = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    m = null;
  }
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}

/** How the meaningful colours look now: the tiers, the four players, good and danger, the elements with their marks. */
function ColorPreview({ mode }: { mode: ColorVisionMode }) {
  const p = PALETTES[mode];
  return (
    <div className="cvd-preview" role="group" aria-label={t.preview}>
      <div className="cvd-row">
        <span className="cvd-label">{t.previewTiers}</span>
        {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((tier, i) => (
          <span key={tier} className="cvd-chip" data-tier={tier}>
            <span className="cvd-pips" aria-hidden="true">
              {'◆'.repeat(i + 1)}
            </span>
            {copy.tiers[tier]}
          </span>
        ))}
      </div>
      <div className="cvd-row">
        <span className="cvd-label">{t.previewTeam}</span>
        {p.team.map((c, i) => (
          <span key={c + i} className="cvd-chip cvd-team" style={{ '--mate': c } as CSSProperties}>
            {t.player(i + 1)}
          </span>
        ))}
      </div>
      <div className="cvd-row">
        <span className="cvd-label">{t.previewSignals}</span>
        <span className="cvd-chip cvd-good">{t.good}</span>
        <span className="cvd-chip cvd-danger">{t.danger}</span>
      </div>
      <div className="cvd-row">
        <span className="cvd-label">{t.previewElements}</span>
        {Object.entries(ELEMENT_GLYPH).map(([id, glyph]) => {
          const name = (copy.hangar.elements as Record<string, string>)[id] ?? id;
          return (
            <span key={id} className="cvd-glyph" role="img" aria-label={name} title={name} style={{ '--el': p.element[id] } as CSSProperties}>
              {[...glyph].map((cell, k) => (
                <i key={k} data-on={cell === '1' || undefined} />
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Motion and colour vision: the game's own, over the operating system's (the preview only in the menu: the pause
 * must fit a 1280×720 screen). */
export function AccessSection({ inRun = false }: { inRun?: boolean }) {
  const motion = usePrefs((p) => p.motion);
  const colorVision = usePrefs((p) => p.colorVision);
  const os = useSyncExternalStore(subscribeSystem, systemReduced, () => false);
  return (
    <>
      <SettingRow
        label={t.motion}
        hint={
          <>
            {t.motionHint}
            {motion === 'system' ? <span className="setting-hint-now">{t.motionSystem(os)}</span> : null}
          </>
        }
      >
        {(ids) => (
          <Segmented<Motion>
            aria-labelledby={ids.label}
            aria-describedby={ids.hint}
            value={motion}
            options={MOTIONS.map((m) => ({ value: m, label: t.motions[m] }))}
            onChange={(m) => setPrefs({ motion: m })}
          />
        )}
      </SettingRow>
      <SettingRow label={t.colorVision} hint={inRun ? undefined : t.colorVisionHint} layout={inRun ? 'side' : 'stack'}>
        {(ids) => (
          <div className="cvd-setting">
            <Select<ColorVisionMode>
              aria-labelledby={ids.label}
              aria-describedby={ids.hint}
              value={colorVision}
              options={COLOR_VISIONS.map((m) => ({ value: m, label: t.colorVisions[m] }))}
              onChange={(m) => setPrefs({ colorVision: m })}
            />
            {inRun ? null : <ColorPreview mode={colorVision} />}
          </div>
        )}
      </SettingRow>
    </>
  );
}

/** The run's own settings: aiming with the mouse (the pause passes the run's live switch). */
export function ArenaSection({ aim, onAim }: { aim: boolean; onAim: (on: boolean) => void }) {
  return (
    <SettingRow label={t.manualAim} hint={t.manualAimHint}>
      {(ids) => <Switch aria-labelledby={ids.label} aria-describedby={ids.hint} checked={aim} onChange={onAim} />}
    </SettingRow>
  );
}

/** Help from the home menu: PERKINS again, the first steps again, the tutorial again. */
export function HelpSection() {
  const [done, setDone] = useState<string | null>(null);
  const restart = useTutorialUpdate();
  const navigate = useNavigate();
  return (
    <>
      <SettingRow label={t.radioTitle} hint={t.radioHint}>
        {() => (
          <button
            type="button"
            className="lip pill small setting-button"
            onClick={() => {
              resetRadio();
              setDone(t.radioDone);
            }}
          >
            {t.radio}
          </button>
        )}
      </SettingRow>
      <SettingRow label={t.firstStepsTitle} hint={t.firstStepsHint}>
        {() => (
          <button
            type="button"
            className="lip pill small setting-button"
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
        )}
      </SettingRow>
      <SettingRow label={t.tutorialTitle} hint={t.tutorialHint}>
        {() => (
          <button
            type="button"
            className="lip pill small setting-button"
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
        )}
      </SettingRow>
      {done ? (
        <p className="setting-done" role="status">
          <Icon name="check" />
          {done}
        </p>
      ) : null}
    </>
  );
}

/** Help during a run: the same actions, waiting for the home menu (they would leave the run). */
export function HelpSectionInRun() {
  return (
    <>
      {(
        [
          [t.radioTitle, t.radioHint, t.radio],
          [t.firstStepsTitle, t.firstStepsHint, t.firstSteps],
          [t.tutorialTitle, t.tutorialHint, t.tutorial],
        ] as const
      ).map(([title, hint, action]) => (
        <SettingRow key={title} label={title} hint={hint} off>
          {() => (
            <button type="button" className="lip pill small setting-button" disabled>
              {action}
            </button>
          )}
        </SettingRow>
      ))}
      <p className="setting-done is-note">
        <Icon name="info" />
        {t.helpInRun}
      </p>
    </>
  );
}
