import type { RoomView } from '@galaxy/shared';
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LiveRooms } from '../src/admin/LiveRooms';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Moderación › Salas en vivo (phase 7): a room playing its run links to watching it live; one in the lobby does not.

const r = copy.admin.moderation.rooms;
const RUN = '00000000-0000-4000-8000-0000000000d1';
const room = (code: string, state: RoomView['state'], run: RoomView['run']): RoomView & { idleSeconds: number } => ({
  id: `00000000-0000-4000-8000-${code === 'ABC234' ? '0000000000e1' : '0000000000e2'}`,
  code,
  kind: 'private',
  sector: 'outer-nebula',
  leader: 'vega',
  state,
  members: [{ username: 'vega', level: 3, probe: 'lumen', ready: true, connected: true, leader: true }],
  max: 4,
  createdAt: '2026-11-09T10:00:00Z',
  canStart: false,
  run,
  idleSeconds: 12,
});

test('una sala que juega lleva a verla en directo; una que espera, no', async () => {
  mockApi({
    'GET /galaxy/api/admin/rooms': () => jsonResponse(200, { rooms: [room('ABC234', 'running', { id: RUN }), room('XYZ789', 'lobby', null)] }),
    'GET /galaxy/api/admin/solo/live': () => jsonResponse(200, { runs: [] }),
  });
  renderAt('/admin/moderacion/salas', { '/admin/moderacion/salas': <LiveRooms /> });
  const link = await screen.findByRole('link', { name: r.watchOf('ABC234') });
  expect(link).toHaveAttribute('href', `/admin/moderacion/directo/${RUN}`);
  expect(screen.queryByRole('link', { name: r.watchOf('XYZ789') })).not.toBeInTheDocument();
});
