import type { RoomKind, RoomsView, RoomView, SoloLiveList } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Rooms (multiplayer plan, phase 5): the open public rooms and mine. Every action answers with my room as it is now;
// the live socket pushes it when someone else changes it (live/LiveConnection.tsx keeps this cache).

export const ROOMS_KEY = ['rooms'] as const;

export function useRooms() {
  return useQuery({ queryKey: ROOMS_KEY, queryFn: () => api<RoomsView>('/rooms'), staleTime: 10_000, refetchInterval: 20_000 });
}

/** My room changed (an answer or the live socket): the cache follows. */
export function setMyRoom(qc: ReturnType<typeof useQueryClient>, room: RoomView | null): void {
  qc.setQueryData<RoomsView>(ROOMS_KEY, (v) => (v ? { ...v, mine: room } : v));
}

type Action =
  | { kind: 'create'; room: RoomKind; sector: string }
  | { kind: 'join'; code: string }
  | { kind: 'quick' }
  | { kind: 'ready'; ready: boolean }
  | { kind: 'sector'; sector: string }
  | { kind: 'type'; room: RoomKind }
  | { kind: 'kick' | 'lead'; username: string }
  | { kind: 'start' };

function call(a: Action): Promise<RoomView> {
  switch (a.kind) {
    case 'create':
      return api<RoomView>('/rooms', { method: 'POST', body: { kind: a.room, sector: a.sector } });
    case 'join':
      return api<RoomView>('/rooms/join', { method: 'POST', body: { code: a.code } });
    case 'quick':
      return api<RoomView>('/rooms/quick', { method: 'POST' });
    case 'ready':
      return api<RoomView>('/rooms/ready', { method: 'POST', body: { ready: a.ready } });
    case 'sector':
      return api<RoomView>('/rooms/sector', { method: 'POST', body: { sector: a.sector } });
    case 'type':
      return api<RoomView>('/rooms/kind', { method: 'POST', body: { kind: a.room } });
    case 'kick':
      return api<RoomView>('/rooms/kick', { method: 'POST', body: { username: a.username } });
    case 'lead':
      return api<RoomView>('/rooms/lead', { method: 'POST', body: { username: a.username } });
    case 'start':
      return api<RoomView>('/rooms/start', { method: 'POST' });
  }
}

export function useRoomAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: call, onSuccess: (room) => setMyRoom(qc, room) });
}

export function useLeaveRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ left: true }>('/rooms/leave', { method: 'POST' }),
    onSuccess: () => {
      setMyRoom(qc, null);
      void qc.invalidateQueries({ queryKey: ROOMS_KEY });
    },
  });
}

export function useInvite() {
  return useMutation({ mutationFn: (username: string) => api<{ sent: true }>('/rooms/invite', { method: 'POST', body: { username } }) });
}

/** The admin panel's live rooms (moderators too), every five seconds. */
export type AdminRoom = RoomView & { idleSeconds: number };
/** The solo runs being played now (plan «escáner pro», part G), every 5 seconds. */
export function useAdminSoloLive() {
  return useQuery({ queryKey: ['admin', 'solo-live'], queryFn: () => api<SoloLiveList>('/admin/solo/live'), refetchInterval: 5000 });
}

export function useAdminRooms() {
  return useQuery({ queryKey: ['admin', 'rooms'], queryFn: () => api<{ rooms: AdminRoom[] }>('/admin/rooms'), refetchInterval: 5000 });
}
