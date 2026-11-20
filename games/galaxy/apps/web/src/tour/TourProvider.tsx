import { TUTORIAL_CHAPTERS, type OnboardingView, type TutorialChapter } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { tourActive, useTutorial, useTutorialUpdate } from '../api/tutorial';
import { useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { onTour } from './bus';
import { chapterSteps, CHAPTER_ROUTE, COUNTED, type TourStep } from './steps';

// The guided tour (GDD §12.2; polish phase 3): a veil with a hole around what matters, a ring that beats round it, an
// arrow that points at it and PERKINS's card with what to do, one step at a time; a docked card when a panel is open;
// a pill that brings the player back when they wander; a burst of stars when a chapter is done. Skippable at any
// moment (Saltar tutorial, or Escape), and never in the admin panel or over the arena (the arena coaches itself).

const t = copy.tour;
const PAD = 10;
/** About how tall a card is, to choose where it fits. */
const CARD_H = 190;

function clip(h: { x: number; y: number; w: number; h: number }, vw: number, vh: number) {
  const x = Math.max(4, h.x);
  const y = Math.max(4, h.y);
  return { x, y, w: Math.max(0, Math.min(vw - 4, h.x + h.w) - x), h: Math.max(0, Math.min(vh - 4, h.y + h.h) - y) };
}

/** The element a step points at, measured again a few times a second (entrances animate, panels scroll). */
function useTargetRect(target: string | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!target) return;
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el && !scrolled) {
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        scrolled = true;
      }
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
    };
    const first = setTimeout(measure, 0);
    const id = setInterval(measure, 150);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [target]);
  // Each step mounts its own card (keyed by step), so a rect never outlives its target.
  return target ? rect : null;
}

/** Another dialog (a panel, the reveal, the relic picker) is open: the card docks and leaves it alone. */
function useOtherDialog(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('[role="dialog"]:not(.tour-card), [role="alertdialog"]:not(.tour-skip)'));
    check();
    const id = setInterval(check, 200);
    return () => clearInterval(id);
  }, []);
  return open;
}

function CoachMark({ step, position, onNext, onSkip, onGo, gift }: { step: TourStep; position: number; onNext: () => void; onSkip: () => void; onGo: () => void; gift: number }) {
  const rect = useTargetRect(step.target);
  const otherDialog = useOtherDialog();
  const docked = step.docked || otherDialog;
  const nextRef = useRef<HTMLButtonElement>(null);
  const modal = step.kind === 'info' && !docked;
  useEffect(() => {
    if (modal) nextRef.current?.focus();
  }, [modal, step.id]);
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  // The hole, kept inside the screen (a whole column can be taller than it).
  const hole = rect && !docked ? clip({ x: rect.left - PAD, y: rect.top - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 }, vw, vh) : null;
  // The card goes under the hole if it fits, else over it, else beside it; centred without a target; in a corner when
  // docked. The arrow points from the card at the hole.
  let cardStyle: CSSProperties;
  let pointer: { x: number; y: number; dir: 'up' | 'down' | 'left' | 'right' } | null = null;
  if (docked) cardStyle = { right: 24, bottom: 24 };
  else if (!hole) cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  else {
    const width = Math.min(380, vw - 32);
    const left = Math.min(Math.max(16, hole.x + hole.w / 2 - width / 2), vw - width - 16);
    const midY = Math.min(Math.max(16, hole.y + hole.h / 2 - CARD_H / 2), vh - CARD_H - 16);
    if (hole.y + hole.h + CARD_H + 60 < vh) {
      cardStyle = { left, top: hole.y + hole.h + 44, width };
      pointer = { x: hole.x + hole.w / 2 - 16, y: hole.y + hole.h + 6, dir: 'up' };
    } else if (hole.y - CARD_H - 60 > 0) {
      cardStyle = { left, bottom: vh - hole.y + 44, width };
      pointer = { x: hole.x + hole.w / 2 - 16, y: hole.y - 38, dir: 'down' };
    } else if (vw - (hole.x + hole.w) > width + 60) {
      cardStyle = { left: hole.x + hole.w + 48, top: midY, width };
      pointer = { x: hole.x + hole.w + 8, y: midY + CARD_H / 2 - 16, dir: 'left' };
    } else if (hole.x > width + 60) {
      cardStyle = { left: hole.x - width - 48, top: midY, width };
      pointer = { x: hole.x - 40, y: midY + CARD_H / 2 - 16, dir: 'right' };
    } else cardStyle = { left, bottom: 24, width };
  }
  return createPortal(
    <div className={`tour${docked ? ' docked' : ''}`}>
      {!docked ? (
        hole ? (
          <>
            <div className="tour-veil" style={{ left: 0, top: 0, width: '100%', height: Math.max(0, hole.y) }} />
            <div className="tour-veil" style={{ left: 0, top: hole.y + hole.h, width: '100%', bottom: 0 }} />
            <div className="tour-veil" style={{ left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h }} />
            <div className="tour-veil" style={{ left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }} />
            {step.kind === 'info' ? <div className="tour-block" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} /> : null}
            <div className="tour-ring" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} aria-hidden="true" />
            {pointer ? (
              <svg className={`tour-pointer ${pointer.dir}`} style={{ left: pointer.x, top: pointer.y }} viewBox="0 0 32 32" aria-hidden="true">
                <path d="M16 2 L28 18 H20 V30 H12 V18 H4 Z" />
              </svg>
            ) : null}
          </>
        ) : (
          <div className="tour-veil" style={{ inset: 0 }} />
        )
      ) : null}
      <div
        className={`tour-card ${step.kind}`}
        style={cardStyle}
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal || undefined}
        aria-label={t.label}
        aria-live={modal ? undefined : 'polite'}
      >
        <span className="tour-avatar" aria-hidden="true">
          <Icon name="radar" />
        </span>
        <div className="tour-body">
          <p className="tour-who">PERKINS</p>
          <p className="tour-text">{step.text({ gift })}</p>
          {step.kind === 'action' && !step.go ? (
            <p className="tour-hint">
              <span className="tour-hand" aria-hidden="true">
                <Icon name="target" />
              </span>
              {docked ? t.inPanel : t.doIt}
            </p>
          ) : null}
          <div className="tour-foot">
            <span className="tour-count">{t.count(position, COUNTED.length)}</span>
            <span className="tour-dots" aria-hidden="true">
              {COUNTED.map((s, i) => (
                <i key={s.id} className={i < position ? 'on' : undefined} />
              ))}
            </span>
          </div>
          <div className="tour-actions">
            <button type="button" className="lip pill small tour-skip-btn" onClick={onSkip}>
              {t.skip}
            </button>
            {step.go ? (
              <button type="button" className="lip pill pill-solar" onClick={onGo} ref={nextRef}>
                {step.go.label}
              </button>
            ) : step.kind === 'info' ? (
              <button type="button" className="lip pill pill-solar" onClick={onNext} ref={nextRef}>
                {t.next}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function TourProvider() {
  const me = useMe().data;
  const tutorial = useTutorial(!!me);
  const update = useTutorialUpdate();
  const v = tutorial.data;
  const active = !!me && tourActive(v);
  const onboarding = useQuery({ queryKey: ['onboarding'], queryFn: () => api<OnboardingView>('/onboarding'), enabled: active, staleTime: 10_000 });
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Where the player is, by the step's id (not its position: the list shrinks when a condition is met meanwhile).
  const [place, setPlace] = useState<{ chapter: TutorialChapter | null; id: string | null }>({ chapter: null, id: null });
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const chapter = v?.chapter ?? 'done';
  const here = place.chapter === chapter ? place.id : null;
  const steps = useMemo(() => chapterSteps(chapter, here, onboarding.data), [chapter, here, onboarding.data]);
  const index = here ? Math.max(0, steps.findIndex((s) => s.id === here)) : 0;
  const step = steps[index];

  const advanceChapter = useCallback(() => {
    const next = TUTORIAL_CHAPTERS[TUTORIAL_CHAPTERS.indexOf(chapter) + 1] ?? 'done';
    update.mutate({ action: 'advance', chapter: next });
    setToast(next === 'done' ? t.finished : t.chapterDone(t.chapters[chapter] ?? ''));
    setPlace({ chapter: next, id: null });
  }, [chapter, update]);
  const next = useCallback(() => {
    if (index + 1 < steps.length) setPlace({ chapter, id: steps[index + 1]!.id });
    else advanceChapter();
  }, [index, steps, chapter, advanceChapter]);

  // A step waiting for an event moves on when it hears it; one waiting for a screen, when the player gets there.
  useEffect(() => (active && step?.advance?.event ? onTour((name) => (name === step.advance!.event ? next() : undefined)) : undefined), [active, step, next]);
  // (Arriving somewhere is answered on the next tick, after the screen has rendered.)
  useEffect(() => {
    if (!(active && step?.advance?.route && pathname === step.advance.route && step.route !== pathname)) return;
    const id = setTimeout(next, 0);
    return () => clearTimeout(id);
  }, [active, step, pathname, next]);
  // The results' chapter is skipped by a player who went home on their own.
  useEffect(() => {
    if (!(active && chapter === 'results' && pathname === '/estacion')) return;
    const id = setTimeout(advanceChapter, 0);
    return () => clearTimeout(id);
  }, [active, chapter, pathname, advanceChapter]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);
  // Escape asks to leave the tour, unless a panel of the game is open (its own Escape wins).
  useEffect(() => {
    // In the arena Escape pauses the run: the tour leaves it alone.
    if (!active || chapter === 'run') return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]:not(.tour-card), [role="alertdialog"]')) return;
      setAsking(true);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [active, chapter]);

  const hiddenHere = pathname.startsWith('/admin') || pathname === '/sonda' || pathname === '/entrar' || pathname === '/crear-cuenta';
  const position = step ? COUNTED.findIndex((s) => s.id === step.id) + 1 : 0;
  return (
    <>
      {active && step && !asking && !hiddenHere && !step.hidden && pathname === step.route && !(chapter === 'station' && update.isPending) ? (
        <CoachMark key={step.id} step={step} position={position} gift={v?.gift ?? 0} onNext={next} onSkip={() => setAsking(true)} onGo={() => step.go && navigate(step.go.to)} />
      ) : null}
      {active && step && !hiddenHere && pathname !== step.route && pathname !== CHAPTER_ROUTE[chapter] ? (
        <Link to={CHAPTER_ROUTE[chapter]} className="lip pill tour-pill">
          <Icon name="compass" />
          <span>{t.pill(t.places[chapter] ?? '')}</span>
        </Link>
      ) : null}
      {toast ? (
        <div className="tour-toast" role="status">
          <span className="tour-burst" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} style={{ '--i': i } as CSSProperties} />
            ))}
          </span>
          <Icon name="check" />
          <span>{toast}</span>
        </div>
      ) : null}
      {asking ? (
        <Dialog title={t.skipTitle} role="alertdialog" className="tour-skip" onClose={() => setAsking(false)}>
          <p>{t.skipText}</p>
          <div className="modal-actions">
            <button type="button" className="lip pill" onClick={() => setAsking(false)} data-autofocus>
              {t.keep}
            </button>
            <button
              type="button"
              className="lip pill danger"
              onClick={() => {
                update.mutate({ action: 'skip' });
                setAsking(false);
              }}
            >
              {t.skipConfirm}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
