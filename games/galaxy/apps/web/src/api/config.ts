import type { ConfigKey } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The live config for admins (GDD §16.3; M6b): every key with what is live, a key's history, and publishing.

export const CONFIG_ADMIN_KEY = ['admin', 'config'] as const;

export interface ConfigKeyRow {
  key: ConfigKey;
  version: number;
  data: Record<string, unknown>;
  createdAt: string | null;
  author: string | null;
  note: string | null;
}

export interface ConfigVersionRow {
  version: number;
  data: unknown;
  createdAt: string;
  author: string | null;
  note: string;
}

export function useConfigKeys() {
  return useQuery({ queryKey: [...CONFIG_ADMIN_KEY, 'keys'], queryFn: () => api<ConfigKeyRow[]>('/admin/config/keys') });
}

export function useConfigVersions(key: string) {
  return useQuery({ queryKey: [...CONFIG_ADMIN_KEY, 'versions', key], queryFn: () => api<ConfigVersionRow[]>(`/admin/config/${key}/versions`) });
}

export function usePublishConfig(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { data: unknown; baseVersion?: number; reason: string; password: string }) => api<{ version: number }>(`/admin/config/${key}`, { method: 'POST', body: v }),
    onSettled: () => void qc.invalidateQueries({ queryKey: CONFIG_ADMIN_KEY }),
  });
}
