import type { PopupView } from '@galaxy/shared';
import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from 'react';
import { CampaignPopup } from '../../popups/CampaignPopup';
import { Icon } from '../../ui/Icon';
import { Segmented } from '../../ui/Segmented';
import { t } from './shared';

// «Así lo verá el jugador» (plan 2026-11-22, part A; DESIGN_SYSTEM §8 quinquagies ter): the real popup (`CampaignPopup`
// inline: nothing is sent, links do not leave) on a stage that stands for a whole screen of 1280, 1920 or 2560 px, its
// veil and all, laid out at that size and scaled down to the column. The popup's sizes follow its container and the
// stage's height (the CSS turns its `vh` into the stage's own), and from 2560 px it is a quarter bigger, as in the game,
// so what the admin sees is what each player gets. It can be answered; «Volver a empezar» opens it again.

const SCREENS = { '1280': [1280, 720], '1920': [1920, 1080], '2560': [2560, 1440] } as const;
type Width = keyof typeof SCREENS;
const WIDTHS = Object.keys(SCREENS) as Width[];

/** The scale that fits `width` logical pixels into `room` real ones (never bigger than life). */
const fit = (room: number, width: number) => Math.min(1, room / width);

export function PopupPreview({ view, initial = '1920' }: { view: PopupView; initial?: Width }) {
  const ids = useId();
  const [width, setWidth] = useState<Width>(initial);
  const [round, setRound] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [w, h] = SCREENS[width];

  // The column's width, measured again whenever it changes (the window, the panel's sidebar).
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Unmeasured (no layout, as in jsdom), life size.
  const scale = room > 0 ? fit(room, w) : 1;
  // Through React's style prop (the CSSOM), never a style="" string: the CSP allows it.
  const frameStyle: CSSProperties = { blockSize: Math.round(h * scale) };
  // Life size when the column is wider than the screen it stands for: centred in it.
  const stageStyle: CSSProperties = { inlineSize: w, blockSize: h, insetInlineStart: Math.max(0, Math.round((room - w * scale) / 2)), transform: `scale(${scale})` };
  return (
    <section className="apop-preview" aria-labelledby={`${ids}-h`}>
      <header className="apop-preview-head">
        <h3 id={`${ids}-h`}>{t.preview}</h3>
        <span id={`${ids}-w`} className="sr-only">
          {t.previewScreen}
        </span>
        <Segmented<Width> aria-labelledby={`${ids}-w`} value={width} options={WIDTHS.map((x) => ({ value: x, label: `${SCREENS[x][0]} × ${SCREENS[x][1]}` }))} onChange={setWidth} />
        <button type="button" className="lip pill small" onClick={() => setRound((n) => n + 1)}>
          <Icon name="flip" />
          <span>{t.previewRestart}</span>
        </button>
      </header>
      <div ref={frame} className="apop-frame" style={frameStyle}>
        <div className="apop-stage" data-w={width} data-kind={view.kind} style={stageStyle}>
          <CampaignPopup key={round} popup={view} inline onDone={() => setRound((n) => n + 1)} />
        </div>
      </div>
      <p className="apop-preview-foot">
        <span>{t.previewSize(w, h, Math.round(scale * 100))}</span>
        <span>{t.previewNote}</span>
      </p>
    </section>
  );
}
