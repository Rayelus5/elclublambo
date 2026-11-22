import type { AdminPopup, AdminPopupList, AdminPopupResults, PopupTextsPage, PopupValidation } from '@galaxy/shared';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The panel's «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5): the list, one campaign, the server's checks of
// a record as the wizard has it, every change, the results, a text question's answers 50 at a time and the CSV. Each
// change reads the panel's campaigns again. Types: packages/shared/src/api/popups.ts.

export const ADMIN_POPUPS_KEY = ['admin', 'popups'] as const;

export function useAdminPopups() {
  return useQuery({ queryKey: ADMIN_POPUPS_KEY, queryFn: () => api<AdminPopupList>('/admin/popups'), staleTime: 10_000 });
}

/** One campaign (a draft the wizard edits, a scheduled one, or the one a copy starts from). */
export function useAdminPopup(id: string | null) {
  return useQuery({ queryKey: [...ADMIN_POPUPS_KEY, 'one', id], queryFn: () => api<AdminPopup>(`/admin/popups/${id}`), enabled: !!id });
}

/** The server's checks of a record as the wizard has it (`id`: the draft being edited). */
export function useValidatePopup(record: unknown, id: string | null, enabled: boolean) {
  const body = id ? { record, id } : { record };
  return useQuery({
    queryKey: [...ADMIN_POPUPS_KEY, 'validate', JSON.stringify(body)],
    queryFn: () => api<PopupValidation>('/admin/popups/validate', { method: 'POST', body }),
    enabled,
    staleTime: 30_000,
    // The last answer stays while the next is asked (the issues and the superadmin note do not flicker while typing).
    placeholderData: keepPreviousData,
  });
}

function usePopupMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_POPUPS_KEY }) });
}

const post = <R>(path: string, body: unknown) => api<R>(`/admin/popups${path}`, { method: 'POST', body });

/** A draft saved: a new one, or the one being edited replaced whole at the version the admin read. */
export const useSavePopup = () =>
  usePopupMutation((v: { id: string | null; version: number | null; record: unknown; reason: string }) =>
    v.id ? post<AdminPopup>(`/${v.id}`, { record: v.record, version: v.version, reason: v.reason }) : post<AdminPopup>('', { record: v.record, reason: v.reason }),
  );
export const useDeletePopup = () => usePopupMutation((v: { id: string; reason: string }) => post<void>(`/${v.id}/delete`, { reason: v.reason }));
/** A draft published at the version the admin reviewed, with their password. */
export const usePublishPopup = () => usePopupMutation((v: { id: string; version: number; reason: string; password: string }) => post<AdminPopup>(`/${v.id}/publish`, { version: v.version, reason: v.reason, password: v.password }));
export const useUnpublishPopup = () => usePopupMutation((v: { id: string; reason: string; password: string }) => post<AdminPopup>(`/${v.id}/unpublish`, { reason: v.reason, password: v.password }));
export const useEndPopup = () => usePopupMutation((v: { id: string; reason: string; password: string }) => post<AdminPopup>(`/${v.id}/end`, { reason: v.reason, password: v.password }));

/** What players did with a campaign and each question summed up; read again every 30 s while it is live. */
export function usePopupResults(id: string) {
  return useQuery({
    queryKey: [...ADMIN_POPUPS_KEY, 'results', id],
    queryFn: () => api<AdminPopupResults>(`/admin/popups/${id}/results`),
    refetchInterval: (q) => (q.state.data?.popup.state === 'live' ? 30_000 : false),
  });
}

/** A text question's answers, newest first, a page at a time («Cargar más» asks for the next). */
export function usePopupTexts(id: string, question: string) {
  return useInfiniteQuery({
    queryKey: [...ADMIN_POPUPS_KEY, 'texts', id, question],
    queryFn: ({ pageParam }) => api<PopupTextsPage>(`/admin/popups/${id}/texts?${new URLSearchParams({ question, ...(pageParam ? { cursor: pageParam } : {}) }).toString()}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
}

/** Where «Exportar CSV» downloads a campaign's answers (one row per response). */
export const popupCsvUrl = (id: string) => `/galaxy/api/admin/popups/${id}/results.csv`;
