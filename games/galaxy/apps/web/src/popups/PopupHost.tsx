import type { PopupView } from '@galaxy/shared';
import { useEffect, useRef, useState } from 'react';
import { useGacha } from '../api/economy';
import { usePopupNext, usePopupShown } from '../api/popups';
import { tourActive, useTutorial } from '../api/tutorial';
import { anyDialogOpen } from '../ui/dialogs';
import { useReducedMotion } from '../ui/motion';
import { CampaignPopup } from './CampaignPopup';

// Where the popups of «Encuestas y avisos» open (GDD §16.5; plan 2026-11-22, part A): only on the title screen, never
// in a run or the lobby. It asks the server which campaign to show only once nothing else asks for the player — the
// guided tour is not running, the event leftovers have been told, the title's entrance is over and no other dialog is
// open — and at most one per app open (this tab's session). Opening one tells the server it was shown (the server
// holds the three shows and the one a day).

/** Written when a popup opens: no other opens until the game is opened again (a new tab). */
export const POPUP_SESSION_KEY = 'galaxy.popup.session';
/** About how long the title screen's entrance lasts (`.enter` cascade, DESIGN_SYSTEM §5). */
const ENTRANCE_MS = 1200;
/** How often to look whether another dialog closed. */
const CALM_MS = 250;

/** Where storage is blocked (some private modes), this page remembers it. */
let openedHere = false;

function openedThisSession(): boolean {
  try {
    return sessionStorage.getItem(POPUP_SESSION_KEY) === '1';
  } catch {
    return openedHere;
  }
}

function markOpened(): void {
  try {
    sessionStorage.setItem(POPUP_SESSION_KEY, '1');
  } catch {
    openedHere = true;
  }
}

/** True once the entrance is over (at once with reduced motion). */
function useEntered(): boolean {
  const reduced = useReducedMotion();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setEntered(true), reduced ? 0 : ENTRANCE_MS);
    return () => clearTimeout(id);
  }, [reduced]);
  return entered;
}

/** While `watching`, whether no other dialog is open (looked at a few times a second). */
function useNoOtherDialog(watching: boolean): boolean {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    if (!watching) return;
    const check = () => setCalm(!anyDialogOpen());
    check();
    const id = setInterval(check, CALM_MS);
    return () => clearInterval(id);
  }, [watching]);
  return watching && calm;
}

export function PopupHost() {
  const [opened, setOpened] = useState(openedThisSession);
  const [popup, setPopup] = useState<PopupView | null>(null);
  const tutorial = useTutorial();
  const gacha = useGacha();
  const entered = useEntered();
  const calm = useNoOtherDialog(entered && !opened);
  const ready =
    !opened &&
    calm &&
    !tutorial.isPending &&
    !tourActive(tutorial.data) &&
    // The leftovers' notice comes first (hub/Leftovers.tsx).
    gacha.data !== undefined &&
    (gacha.data.leftovers ?? []).length === 0;
  const next = usePopupNext(ready);
  const { mutate: countShow } = usePopupShown();
  const found = next.data?.popup ?? null;
  const counted = useRef<string | null>(null);

  // The answer arrived: it opens now, unless a dialog opened while it travelled (React's pattern for state that
  // follows new data, set while rendering).
  if (ready && found && !anyDialogOpen()) {
    setOpened(true);
    setPopup(found);
  }

  // Opened: this session shows no other, and the server counts the show (once, even when React runs effects twice).
  useEffect(() => {
    if (!popup || counted.current === popup.id) return;
    counted.current = popup.id;
    markOpened();
    countShow(popup.id);
  }, [popup, countShow]);

  return popup ? <CampaignPopup popup={popup} onDone={() => setPopup(null)} /> : null;
}
