import { inAudience, type MailAudience } from '../api/mail';
import { POPUP_MAX_SHOWS, POPUPS_PER_DAY, popupState, type PopupStoredState } from './record';

// «Encuestas y avisos» (GDD §16.5; plan 2026-11-22, part A): which popup a player sees when they open the game. Pure:
// `GET /popups/next` only reads with it (loading again never spends a show), and `POST /popups/:id/shown` enforces the
// same rules when it counts one. «Más tarde» brings a campaign back in another session, three shows at most and never
// twice in the same Madrid day; at most one popup a day over every campaign, the one that matters most [U].

/** A campaign as the choice reads it. */
export interface PopupCandidate {
  id: string;
  state: PopupStoredState;
  startsAt: string;
  endsAt: string;
  endedAt: string | null;
  /** 0 Baja, 1 Normal, 2 Alta. */
  priority: number;
  audience: MailAudience;
}

/** What a player did with a campaign (its `popup_views` row). */
export interface PopupViewState {
  campaignId: string;
  /** Times it was shown (one a day at most). */
  shows: number;
  /** The Madrid day (yyyy-mm-dd) of its last show, or null. */
  lastShownDay: string | null;
  /** Answered, or a promotion closed: it never comes back. */
  done: boolean;
}

/** The limits of the choice (the defaults are the owner's rules). */
export interface PopupRules {
  maxShows: number;
  perDay: number;
}

export const POPUP_RULES: PopupRules = { maxShows: POPUP_MAX_SHOWS, perDay: POPUPS_PER_DAY };

/**
 * The id of the popup a player sees now (`today`: the Madrid day of `now`), or null. A campaign must be live, have the
 * player in its audience as of now (so newcomers are in, unless the admin set join dates), not be done, have been shown
 * fewer than `maxShows` times and not today; and no more than `perDay` popups shown today over every campaign. The
 * highest priority wins, then the newest start, then the lowest id.
 */
export function nextPopup(
  campaigns: readonly PopupCandidate[],
  views: readonly PopupViewState[],
  account: { level: number; createdAt: Date; username: string },
  now: Date,
  today: string,
  rules: PopupRules = POPUP_RULES,
): string | null {
  if (views.filter((v) => v.lastShownDay === today).length >= rules.perDay) return null;
  const byId = new Map(views.map((v) => [v.campaignId, v]));
  const open = campaigns.filter((c) => {
    if (popupState(c, now) !== 'live') return false;
    if (!inAudience(c.audience, account, now)) return false;
    const v = byId.get(c.id);
    return !v || (!v.done && v.shows < rules.maxShows && v.lastShownDay !== today);
  });
  open.sort((a, b) => b.priority - a.priority || Date.parse(b.startsAt) - Date.parse(a.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return open[0]?.id ?? null;
}
