import { z } from 'zod';
import type { Wallet } from '../gacha/types';
import type { RoomId, RoomStatus } from '../station/rooms';

// The station's API (GDD §10, §11.3): the view of the rooms, the refinery and the antenna with the wallet, and the four
// actions. Every action carries an `Idempotency-Key` and answers with the new view.

export interface StationRoomView extends RoomStatus {
  id: RoomId;
}

export interface StationView {
  rooms: StationRoomView[];
  refinery: {
    level: number;
    /** Material refined per hour. */
    rate: number;
    capacity: number;
    queue: number;
    ready: number;
    /** When the next component will be ready (null with an empty queue), ISO. */
    nextAt: string | null;
  };
  antenna: {
    /** 0: broken. */
    level: number;
    /** Signals per hour. */
    rate: number;
    capHours: number;
    /** Whole signals waiting to be collected. */
    accrued: number;
    /** When it stops accruing (null while broken), ISO. */
    fullAt: string | null;
  };
  wallet: Wallet;
}

export const refineryLoadSchema = z.object({ amount: z.number().int().min(1).max(1_000_000) }).strict();
export type RefineryLoad = z.infer<typeof refineryLoadSchema>;
