import type { AdminMailRow, AdminNoticeRow, MailAudience, MyMailbox, TitleNotice, Wallet } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';
import { GACHA_KEY } from './economy';

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

export function useClaimMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ wallet: Wallet }>(`/mailbox/${id}/claim`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(GACHA_KEY, (old: Record<string, unknown> | undefined) => (old ? { ...old, wallet: r.wallet } : old)),
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
