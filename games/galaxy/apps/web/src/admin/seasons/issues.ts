import type { SeasonIssue } from '@galaxy/shared';
import { copy } from '../../copy/es';
import { issueText as formIssueText } from '../forms/issues';

// A season's problems in words (plan «temporadas como fichas»): the wizard's review and the dialogs that change a
// scheduled season (moving its end answers with what the new dates would break) say them the same way.

const t = copy.admin.seasons;

/** One season issue as an admin reads it (its path and code when nothing names it). */
export function seasonIssueText(i: SeasonIssue): string {
  if (i.message.startsWith('season_overlap:')) return t.overlapWith(i.message.slice('season_overlap:'.length));
  if (i.message.startsWith('mission_duplicate:')) return t.duplicateMission(i.message.slice('mission_duplicate:'.length));
  // A gift's problem, as the mail says it.
  if (i.message.startsWith('gift_')) {
    const said = (copy.gifts.issues as Record<string, string>)[i.message.slice('gift_'.length)];
    if (said) return said;
  }
  const own = t.issueText[i.message];
  if (own) return own;
  // The checks the config keys share (the seasonal lab tree's, over the permanent one), as the config form says them.
  const shared = formIssueText(i.message);
  return shared !== i.message ? shared : `${i.path ? `${i.path} ` : ''}${i.message}`;
}
