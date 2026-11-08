import type { ChatChannel } from '@galaxy/shared';
import { create } from 'zustand';

/** Global UI state that is not server data (TanStack Query owns that). */
type UiState = {
  /** Set when any API call answers 503 maintenance. */
  maintenance: boolean;
  setMaintenance: (on: boolean) => void;
  /** The chat sheet and the channel it shows, or null when it is closed (M5b-2). */
  chat: ChatChannel | null;
  openChat: (channel: ChatChannel) => void;
  closeChat: () => void;
};

export const useUi = create<UiState>((set) => ({
  maintenance: false,
  setMaintenance: (on) => set({ maintenance: on }),
  chat: null,
  openChat: (channel) => set({ chat: channel }),
  closeChat: () => set({ chat: null }),
}));
