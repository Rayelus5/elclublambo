import type { ConfigKey } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { CONTENT_KEY } from './content';

// The live config for admins (GDD §16.3; M6b): every key with what is live, a key's history, and publishing.

export const CONFIG_ADMIN_KEY = ['admin', 'config'] as const;

export interface ConfigKeyRow {
  key: ConfigKey;
  version: number;
  /** Absent on a `lazy` row of the list: ask for it with `useConfigKey`. */
  data: Record<string, unknown>;
  createdAt: string | null;
  author: string | null;
  note: string | null;
  /** The list leaves the big keys' data out (the run content, about 180 KB; 2026-11-16). */
  lazy?: boolean;
}

/** A version in a key's history, without its data (asked for with `fetchConfigVersion`). */
export interface ConfigVersionRow {
  version: number;
  createdAt: string;
  author: string | null;
  note: string;
}

export function useConfigKeys() {
  return useQuery({ queryKey: [...CONFIG_ADMIN_KEY, 'keys'], queryFn: () => api<ConfigKeyRow[]>('/admin/config/keys') });
}

/** One key with its data (a `lazy` key of the list, 2026-11-16). */
export function useConfigKey(key: string, enabled = true) {
  return useQuery({ queryKey: [...CONFIG_ADMIN_KEY, 'key', key], queryFn: () => api<ConfigKeyRow>(`/admin/config/${key}`), enabled });
}

export function useConfigVersions(key: string) {
  return useQuery({ queryKey: [...CONFIG_ADMIN_KEY, 'versions', key], queryFn: () => api<ConfigVersionRow[]>(`/admin/config/${key}/versions`) });
}

/** One old version with its data, when it is loaded into the editor (cached: a version never changes). */
export function useFetchConfigVersion() {
  const qc = useQueryClient();
  return (key: string, version: number) =>
    qc.fetchQuery({
      queryKey: [...CONFIG_ADMIN_KEY, 'version', key, version],
      queryFn: () => api<ConfigVersionRow & { data: unknown }>(`/admin/config/${key}/versions/${version}`),
      staleTime: Infinity,
    });
}

/** Several keys at once, all or nothing (polish phase 4): an event and its scanner. */
export function usePublishBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { items: { key: ConfigKey; data: unknown; baseVersion?: number }[]; reason: string; password: string }) =>
      api<{ versions: Record<string, number> }>('/admin/config/batch', { method: 'POST', body: v }),
    onSettled: () => void qc.invalidateQueries({ queryKey: CONFIG_ADMIN_KEY }),
  });
}

export function usePublishConfig(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { data: unknown; baseVersion?: number; reason: string; password: string }) => api<{ version: number }>(`/admin/config/${key}`, { method: 'POST', body: v }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CONFIG_ADMIN_KEY });
      // The whole web reads the published content (2026-11-16): a new version shows at once.
      if (key === 'content') void qc.invalidateQueries({ queryKey: CONTENT_KEY });
    },
  });
}
