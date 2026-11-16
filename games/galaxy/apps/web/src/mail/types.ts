import type { MailType } from '@galaxy/shared';
import { copy } from '../copy/es';
import type { IconName } from '../ui/Icon';

// Each kind of message's look (mail v2, 2026-11-16, the owner: «Sí, con su estilo»): its icon and colour, the same in
// the panel's type picker, the letter's stamp, the mailbox's list and filter, and the live notice.

export const MAIL_TYPE_LOOK: Record<MailType, { icon: IconName; tone: 'sky' | 'solar' | 'terminal' | 'nova' | 'uv' | 'ice' }> = {
  announcement: { icon: 'megaphone', tone: 'sky' },
  gift: { icon: 'starOn', tone: 'solar' },
  compensation: { icon: 'wrench', tone: 'terminal' },
  event: { icon: 'calendar', tone: 'nova' },
  reward: { icon: 'trophy', tone: 'uv' },
  personal: { icon: 'mail', tone: 'ice' },
  referral: { icon: 'addFriend', tone: 'terminal' },
  shop: { icon: 'store', tone: 'solar' },
  system: { icon: 'info', tone: 'ice' },
};

export const mailTypeName = (type: MailType): string => copy.mailTypes[type].name;
