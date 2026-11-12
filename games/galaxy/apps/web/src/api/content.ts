import type { LiveContentView } from '@galaxy/shared';
import { type Content, DEFAULT_CONTENT } from '@galaxy/sim';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// The content published on PRE (plan «escáner pro», part D): what the web tells about relics and sets is told with it,
// so a relic retuned from the admin reads right without a deploy. The built-in content stands in while it loads (or
// if it cannot). The server answers an unchanged version with a 304 (ETag).

export const CONTENT_KEY = ['content'] as const;

export function useLiveContent(): Content {
  const q = useQuery({ queryKey: CONTENT_KEY, queryFn: () => api<LiveContentView>('/content'), staleTime: 5 * 60_000, retry: false });
  return q.data?.content ?? DEFAULT_CONTENT;
}
