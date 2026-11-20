import type { AdminMailRow, AdminNoticeRow, GrantedItem, MailAudience, MyMailbox, TitleNotice, Wallet } from '@galaxy/shared';
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';
import { ME_KEY } from '../auth/useMe';
import { COSMETICS_KEY } from './cosmetics';
import { COLLECTION_KEY, GACHA_KEY } from './economy';
import { HANGAR_KEY } from './runs';

// The mailbox and the title notices for players, and communication in the panel (GDD §16.5; M6d-1). Reading and
// claiming read the mailbox again; a claim also brings the new wallet to the top bar at once.

export const MAILBOX_KEY = ['mailbox'] as const;

export function useMailbox() {
  return useQuery({ queryKey: MAILBOX_KEY, queryFn: () => api<MyMailbox>('/mailbox'), staleTime: 60_000 });
}

export function useReadMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ read: true }>(`/mailbox/${id}/read`, { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: MAILBOX_KEY }),
  });
}

/** After a claim: the wallet at once, and everything else a gift can change (mail v2: pieces, galaxies, probes, XP). */
function claimed(qc: QueryClient, wallet: Wallet): void {
  qc.setQueryData(GACHA_KEY, (old: Record<string, unknown> | undefined) => (old ? { ...old, wallet } : old));
  for (const key of [COSMETICS_KEY, COLLECTION_KEY, HANGAR_KEY, ME_KEY]) void qc.invalidateQueries({ queryKey: key });
}

export function useClaimMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ wallet: Wallet; granted?: GrantedItem[] }>(`/mailbox/${id}/claim`, { method: 'POST' }),
    onSuccess: (r) => claimed(qc, r.wallet),
    onSettled: () => void qc.invalidateQueries({ queryKey: MAILBOX_KEY }),
  });
}

/** The mailbox v2's pages (P6): the inbox or the archive, newest first, one page after another. */
const mailboxUrl = (box: 'inbox' | 'archive', cursor: string | null) => {
  const q = new URLSearchParams();
  if (box === 'archive') q.set('box', 'archive');
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return `/mailbox${s ? `?${s}` : ''}`;
};

export function useMailboxPages(box: 'inbox' | 'archive') {
  return useInfiniteQuery({
    queryKey: [...MAILBOX_KEY, 'pages', box],
    queryFn: ({ pageParam }) => api<MyMailbox>(mailboxUrl(box, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    staleTime: 60_000,
  });
}

/** Collects every gift still to claim (up to 50 messages): what each gave, for the reveal. */
export function useClaimAllMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ claimed: number; granted: { id: string; items: GrantedItem[] }[]; wallet: Wallet }>('/mailbox/claim-all', { method: 'POST' }),
    onSuccess: (r) => claimed(qc, r.wallet),
    onSettled: () => void qc.invalidateQueries({ queryKey: MAILBOX_KEY }),
  });
}

export function useArchiveMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => api<{ archived: boolean }>(`/mailbox/${v.id}`, { method: 'PATCH', body: { archived: v.archived } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: MAILBOX_KEY }),
  });
}

export function useDeleteMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ deleted: true }>(`/mailbox/${id}`, { method: 'DELETE' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: MAILBOX_KEY }),
  });
}

export function useNotices() {
  return useQuery({ queryKey: ['notices'], queryFn: () => api<TitleNotice[]>('/notices'), staleTime: 5 * 60_000 });
}

export function useAdminMail() {
  return useQuery({ queryKey: [...ADMIN_KEY, 'mail'], queryFn: () => api<AdminMailRow[]>('/admin/mail') });
}

/** How many accounts an audience reaches now (asked only for a complete audience). */
export function useMailPreview(audience: MailAudience | null) {
  return useQuery({
    queryKey: [...ADMIN_KEY, 'mail-preview', audience],
    queryFn: () => api<{ recipients: number }>('/admin/mail/preview', { method: 'POST', body: { audience } }),
    enabled: audience !== null,
  });
}

export function useAdminNotices() {
  return useQuery({ queryKey: [...ADMIN_KEY, 'notices'], queryFn: () => api<AdminNoticeRow[]>('/admin/notices') });
}
