import type { DraftConflict, DraftKey, DraftSummary, DraftView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { CONFIG_ADMIN_KEY } from './config';
import { CONTENT_KEY } from './content';

// Config drafts on the server (the content editor, 2026-11-16, P2): any admin resumes them, saves them field by field,
// merges them with what was published since, tries them in a test run, publishes or discards them.

export const DRAFTS_KEY = ['admin', 'config-drafts'] as const;
const BASE = '/admin/config-drafts';

export function useDrafts() {
  return useQuery({ queryKey: DRAFTS_KEY, queryFn: () => api<DraftSummary[]>(BASE) });
}

export function useDraft(id: string | null) {
  return useQuery({ queryKey: [...DRAFTS_KEY, id], queryFn: () => api<DraftView>(`${BASE}/${id}`), enabled: !!id });
}

export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => api<DraftView>(BASE, { method: 'POST', body: { title } }),
    onSuccess: (d) => {
      qc.setQueryData([...DRAFTS_KEY, d.id], d);
      void qc.invalidateQueries({ queryKey: DRAFTS_KEY, exact: true });
    },
  });
}

/** One field of a key, on the revision the editor has (409 draft_conflict if another tab saved first). */
export function saveDraftField(id: string, change: { key: DraftKey; field: string; value: unknown; revision: number }) {
  return api<DraftView>(`${BASE}/${id}/field`, { method: 'PUT', body: change });
}

export function useRebaseDraft(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resolutions: Partial<Record<DraftKey, Record<string, Record<string, 'mine' | 'live'>>>>) =>
      api<{ draft: DraftView; conflicts: DraftConflict[] }>(`${BASE}/${id}/rebase`, { method: 'POST', body: { resolutions } }),
    onSuccess: (r) => {
      if (r.conflicts.length === 0) qc.setQueryData([...DRAFTS_KEY, id], r.draft);
      void qc.invalidateQueries({ queryKey: DRAFTS_KEY, exact: true });
    },
  });
}

export function usePublishDraft(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { reason: string; password: string }) => api<{ versions: Partial<Record<DraftKey, number>> }>(`${BASE}/${id}/publish`, { method: 'POST', body: v }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DRAFTS_KEY });
      void qc.invalidateQueries({ queryKey: CONFIG_ADMIN_KEY });
      // The whole web reads the published content: a new version shows at once.
      void qc.invalidateQueries({ queryKey: CONTENT_KEY });
    },
  });
}

export function useDiscardDraft(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: DRAFTS_KEY }),
  });
}
