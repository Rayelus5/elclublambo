import type { AdminMediaView, AdminNewsView, NewsPostInput, NewsSection, NewsView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// The news board (the owner, 2026-11-14): the cards on now for everyone, and the panel's hand on them and on the
// images uploaded for them. Every change reads the board again (the panel's and the players').

export const NEWS_KEY = ['news'] as const;
const ADMIN_NEWS = [...ADMIN_KEY, 'news'] as const;
const ADMIN_MEDIA = [...ADMIN_KEY, 'media'] as const;

export function useNews() {
  return useQuery({ queryKey: NEWS_KEY, queryFn: () => api<NewsView>('/news'), staleTime: 2 * 60_000 });
}

export function useAdminNews() {
  return useQuery({ queryKey: ADMIN_NEWS, queryFn: () => api<AdminNewsView>('/admin/news') });
}

export function useAdminMedia() {
  return useQuery({ queryKey: ADMIN_MEDIA, queryFn: () => api<AdminMediaView>('/admin/media') });
}

function useNewsChange<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ADMIN_NEWS });
      void qc.invalidateQueries({ queryKey: ADMIN_MEDIA });
      void qc.invalidateQueries({ queryKey: NEWS_KEY });
    },
  });
}

export function useSaveNews() {
  return useNewsChange((v: { id: string | null; post: NewsPostInput; reason: string }) =>
    v.id
      ? api(`/admin/news/${v.id}`, { method: 'PUT', body: { ...v.post, reason: v.reason } })
      : api<{ id: string }>('/admin/news', { method: 'POST', body: { ...v.post, reason: v.reason } }),
  );
}

export function useNewsAction() {
  return useNewsChange((v: { id: string; action: 'hide' | 'show' | 'delete'; reason: string }) => api(`/admin/news/${v.id}/${v.action}`, { method: 'POST', body: { reason: v.reason } }));
}

export function useOrderNews() {
  return useNewsChange((v: { section: NewsSection; ids: string[] }) => api('/admin/news/order', { method: 'POST', body: v }));
}

/** A file to base64 (the upload is JSON). */
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useUploadMedia() {
  return useNewsChange(async (file: File) => api<{ id: string }>('/admin/media', { method: 'POST', body: { name: file.name.slice(0, 80) || 'imagen', data: await fileBase64(file) } }));
}

export function useDeleteMedia() {
  return useNewsChange((v: { id: string; reason: string }) => api(`/admin/media/${v.id}/delete`, { method: 'POST', body: { reason: v.reason } }));
}
