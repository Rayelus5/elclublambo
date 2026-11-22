import type { Gift, GrantedItem, PopupQuestionView, PopupView } from '@galaxy/shared';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePopupAnswer, usePopupLater, usePopupSeen } from '../api/popups';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { GiftArt } from '../gifts/GiftArt';
import { usePlayerGiftView } from '../gifts/usePlayerGiftView';
import { giftWords } from '../gifts/words';
import { GiftReveal } from '../mail/GiftReveal';
import { playClaim } from '../missions/sfx';
import { giftsReward } from '../season/gifts';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { answered, answersOf, type Draft, type Drafts, screensOf } from './draft';
import { PromotionBody } from './PromotionBody';
import { ChoiceQuestion } from './questions/ChoiceQuestion';
import { ScaleQuestion } from './questions/ScaleQuestion';
import { StarsQuestion } from './questions/StarsQuestion';
import { TextQuestion } from './questions/TextQuestion';

// The popup of a campaign of «Encuestas y avisos» (GDD §16.5; plan 2026-11-22, part A; DESIGN_SYSTEM §8 quinquagies
// ter), over the title screen. A survey is bare like the owner's mock-ups: the question in big display letters straight
// on the veil, its scale, and «Enviar». A review and a form are a panel (a form one question per screen, with its
// progress); a promotion is its image, title, text and round «Ver más». Questions close with «Más tarde» (or Escape),
// which brings them back another day; a promotion closes for good, through «Ver más» or not. A reward is announced on
// the last screen and revealed when the answers land; without one, the thanks come in the same dialog.

const t = copy.popups;

export interface CampaignPopupProps {
  /** The campaign as the player sees it (`GET /popups/next`). */
  popup: PopupView;
  /** It is over for now: answered, «Más tarde», or a promotion closed. */
  onDone: () => void;
  /**
   * The panel's «Así lo verá el jugador»: drawn in place inside `.pop-scene` (no portal, no veil, the focus not trapped)
   * and nothing is sent; answering shows the thanks as the player would see them, and links do not leave.
   */
  inline?: boolean;
}

/** The kind's look: a survey without an image is the bare screen of the mock-ups; the rest are panels. */
function lookOf(popup: PopupView): string {
  if (popup.kind === 'promotion') return 'pop pop-promo';
  if (popup.kind === 'survey' && !popup.image) return 'pop pop-bare';
  return `pop pop-panel pop-${popup.kind}`;
}

export function CampaignPopup({ popup, onDone, inline = false }: CampaignPopupProps) {
  const screens = useMemo(() => screensOf(popup), [popup]);
  const [step, setStep] = useState(0);
  const [back, setBack] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [thanks, setThanks] = useState(false);
  const [granted, setGranted] = useState<GrantedItem[] | null>(null);
  const later = usePopupLater();
  const seen = usePopupSeen();
  const answer = usePopupAnswer();
  const screen = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState(false);
  const promo = popup.kind === 'promotion';
  const bare = lookOf(popup).includes('pop-bare');
  const questions = screens[step] ?? [];
  const last = step >= screens.length - 1;
  const ready = questions.every((q) => answered(q, drafts[q.id]));
  const sending = answer.isPending;

  // A new screen takes the focus where its answer starts (only when the player moved: the dialog places it first).
  useEffect(() => {
    if (!moved) return;
    screen.current?.querySelector<HTMLElement>('[tabindex="0"], [role="checkbox"], textarea')?.focus();
  }, [moved, step]);

  const finish = () => onDone();
  const dismiss = () => {
    if (sending) return;
    if (!inline) later.mutate(popup.id);
    finish();
  };
  const close = (clicked: boolean) => {
    if (!inline) seen.mutate({ id: popup.id, clicked });
    finish();
  };
  const go = (to: number) => {
    setMoved(true);
    setBack(to < step);
    setStep(to);
  };
  const set = (id: string, d: Draft) => setDrafts((all) => ({ ...all, [id]: { ...all[id], ...d } }));
  const send = () => {
    if (!ready || sending) return;
    if (inline) {
      setThanks(true);
      return;
    }
    answer.mutate(
      { id: popup.id, answers: answersOf(popup.questions, drafts) },
      {
        onSuccess: (r) => {
          setThanks(true);
          if (r.granted && r.granted.length > 0) setGranted(r.granted);
        },
      },
    );
  };

  const onClose = promo ? () => close(false) : thanks ? finish : dismiss;
  const error = errorText(answer.error, copy.errors);

  let body: ReactNode;
  if (promo) body = <PromotionBody popup={popup} inline={inline} onMore={() => close(true)} onClose={() => close(false)} />;
  else if (thanks) body = <Thanks rewarded={granted !== null || (inline && popup.reward.length > 0)} onClose={finish} />;
  else
    body = (
      <>
        {popup.image ? <img className="pop-banner" src={popup.image} alt="" draggable={false} /> : null}
        {popup.body && step === 0 ? <p className="pop-lead">{popup.body}</p> : null}
        {screens.length > 1 ? <Steps at={step} of={screens.length} /> : null}
        <div ref={screen} key={step} className={`pop-screen${moved ? ' moved' : ''}${back ? ' back' : ''}`}>
          {questions.map((q) => (
            <Question key={q.id} q={q} draft={drafts[q.id]} big={bare} onChange={(d) => set(q.id, d)} />
          ))}
        </div>
        {last && popup.reward.length > 0 ? <RewardStrip gifts={popup.reward} /> : null}
        {error ? (
          <p className="field-error pop-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pop-actions">
          <button type="button" className="lip pill pop-later" disabled={sending} onClick={dismiss}>
            {t.later}
          </button>
          {step > 0 ? (
            <button type="button" className="lip pill pop-prev" disabled={sending} onClick={() => go(step - 1)}>
              <Icon name="back" />
              {t.previous}
            </button>
          ) : null}
          {last ? (
            <button type="button" className="lip pill pill-solar pop-send" disabled={!ready || sending} aria-busy={sending || undefined} onClick={send}>
              {t.send}
            </button>
          ) : (
            <button type="button" className="lip pill pill-solar pop-next" disabled={!ready} onClick={() => go(step + 1)}>
              {t.next}
              <Icon name="next" />
            </button>
          )}
        </div>
      </>
    );

  return (
    <>
      <Frame inline={inline} title={popup.title} className={`${lookOf(popup)}${thanks ? ' pop-done' : ''}`} onClose={onClose} closeOnVeil={promo}>
        {body}
      </Frame>
      {granted && !inline ? <Granted granted={granted} onClose={finish} /> : null}
    </>
  );
}

/** The dialog over the title screen, or the same box in place for the panel's preview. */
function Frame({ inline, title, className, onClose, closeOnVeil, children }: { inline: boolean; title: string; className: string; onClose: () => void; closeOnVeil: boolean; children: ReactNode }) {
  const id = useId();
  if (!inline)
    return (
      <Dialog title={title} className={className} onClose={onClose} closeOnVeil={closeOnVeil}>
        {children}
      </Dialog>
    );
  return (
    <div className="pop-scene">
      <section className={`lip panel modal ${className}`} aria-labelledby={id}>
        <h2 id={id} className="modal-title">
          {title}
        </h2>
        {children}
      </section>
    </div>
  );
}

function Question({ q, draft, big, onChange }: { q: PopupQuestionView; draft: Draft | undefined; big: boolean; onChange: (d: Draft) => void }) {
  switch (q.type) {
    case 'scale':
      return <ScaleQuestion q={q} value={draft?.score} big={big} onChange={(score) => onChange({ score })} />;
    case 'stars':
      return <StarsQuestion q={q} value={draft?.score} onChange={(score) => onChange({ score })} />;
    case 'choice':
      return <ChoiceQuestion q={q} value={draft?.choices} onChange={(choices) => onChange({ choices })} />;
    case 'text':
      return <TextQuestion q={q} value={draft?.text} onChange={(text) => onChange({ text })} />;
  }
}

/** A form's progress: a pip per question (the ones done lit) and «2 de 3». */
function Steps({ at, of }: { at: number; of: number }) {
  return (
    <p className="pop-steps">
      <span className="pop-pips" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <i key={i} className={i < at ? 'done' : i === at ? 'now' : undefined} />
        ))}
      </span>
      {t.step(at + 1, of)}
    </p>
  );
}

/** What answering gives, on the last screen: the first gifts drawn with their words. */
function RewardStrip({ gifts }: { gifts: readonly Gift[] }) {
  const view = usePlayerGiftView();
  const shown = gifts.slice(0, 4);
  const more = gifts.length - shown.length;
  return (
    <div className="pop-reward">
      <span className="pop-reward-lead">
        <Icon name="star" />
        {t.rewardLead}
      </span>
      <ul className="pop-reward-gifts">
        {shown.map((g, i) => (
          <li key={i}>
            <GiftArt gift={g} catalog={view} compact />
            <span>{giftWords(g, view)}</span>
          </li>
        ))}
        {more > 0 ? <li className="pop-reward-more">{t.rewardMore(more)}</li> : null}
      </ul>
    </div>
  );
}

/** The thanks, in the same box: with a reward, that it is already in the account (its reveal opens on top). */
function Thanks({ rewarded, onClose }: { rewarded: boolean; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="pop-thanks">
      <span className="lip pop-thanks-badge" aria-hidden="true">
        <Icon name="tick" />
      </span>
      <p className="pop-thanks-title" role="status">
        {t.thanks}
      </p>
      {rewarded ? <p className="pop-thanks-line">{t.rewardIn}</p> : null}
      <div className="pop-actions">
        <button ref={ref} type="button" className="lip pill pill-solar pop-send" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </div>
  );
}

/** What the reward gave: its sound once, and the mailbox's reveal; closing it closes the popup. */
function Granted({ granted, onClose }: { granted: readonly GrantedItem[]; onClose: () => void }) {
  const view = usePlayerGiftView();
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    playClaim(
      giftsReward(
        granted.filter((g) => g.outcome === 'granted').map((g) => g.gift),
        view,
      ),
      false,
    );
  }, [granted, view]);
  return <GiftReveal granted={granted} catalog={view} onClose={onClose} onLeave={onClose} />;
}
