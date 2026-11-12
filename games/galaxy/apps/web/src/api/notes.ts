import type { AdminReleaseNote, AdminReleaseNotesView, ReleaseNote, ReleaseNotesView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// «Notas de versión» (plan «notas de versión»): the players' list (read on the home menu for its «Nuevo» and on its
// page) and the panel's, with saving, hiding, restoring and deleting. Every change reads both lists again.

export const NOTES_KEY = ['notes'] as const;
export const ADMIN_NOTES_KEY = ['admin', 'notes'] as const;

export function useReleaseNotes() {
  return useQuery({ queryKey: NOTES_KEY, queryFn: () => api<ReleaseNotesView>('/notes'), staleTime: 5 * 60_000, retry: false });
}

export function useAdminNotes() {
  return useQuery({ queryKey: ADMIN_NOTES_KEY, queryFn: () => api<AdminReleaseNotesView>('/admin/notes') });
}

export type NoteAction = 'hide' | 'restore' | 'revert' | 'delete';

export function useNoteChange() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ADMIN_NOTES_KEY });
    void qc.invalidateQueries({ queryKey: NOTES_KEY });
  };
  const save = useMutation({
    mutationFn: ({ id, note }: { id: string; note: Omit<ReleaseNote, 'id'> }) => api<AdminReleaseNote>(`/admin/notes/${id}`, { method: 'PUT', body: note }),
    onSettled: settle,
  });
  const create = useMutation({
    mutationFn: (note: ReleaseNote) => api<AdminReleaseNote>('/admin/notes', { method: 'POST', body: note }),
    onSettled: settle,
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: NoteAction }) => api<unknown>(`/admin/notes/${id}/${action}`, { method: 'POST' }),
    onSettled: settle,
  });
  return { save, create, act };
}
