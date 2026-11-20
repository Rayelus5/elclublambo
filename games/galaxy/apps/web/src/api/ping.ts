import type { GameServer } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';

// The game server's ping (2026-11-17, the owner: the server «será visible (junto con el ping)»): a few empty 204s in a
// row, through the same tunnel as the game's sockets. The first one opens the connection and is dropped; the median of
// the rest is the round trip a player feels. Measured again every 15 s while it shows.

const SAMPLES = 4;

export async function measurePing(url: string, now: () => number = () => performance.now()): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = now();
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`ping ${res.status}`);
    times.push(now() - t0);
  }
  const rest = times.slice(1).sort((a, b) => a - b);
  return Math.max(1, Math.round(rest[Math.floor(rest.length / 2)]!));
}

/** How the ping feels: under 70 ms good, under 140 fair, else poor. */
export function pingQuality(ms: number | null): 'good' | 'fair' | 'poor' | 'unknown' {
  if (ms === null) return 'unknown';
  return ms < 70 ? 'good' : ms < 140 ? 'fair' : 'poor';
}

export function useServerPing(server: GameServer) {
  return useQuery({ queryKey: ['ping', server.id], queryFn: () => measurePing(server.ping), refetchInterval: 15_000, staleTime: 10_000, retry: false });
}
