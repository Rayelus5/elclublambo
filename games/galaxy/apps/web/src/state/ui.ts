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
  /** The friends sheet (plan phase 3); it and the chat share the right side, so opening one closes the other. */
  friends: boolean;
  openFriends: () => void;
  closeFriends: () => void;
};

export const useUi = create<UiState>((set) => ({
  maintenance: false,
  setMaintenance: (on) => set({ maintenance: on }),
  chat: null,
  openChat: (channel) => set({ chat: channel, friends: false }),
  closeChat: () => set({ chat: null }),
  friends: false,
  openFriends: () => set({ friends: true, chat: null }),
  closeFriends: () => set({ friends: false }),
}));
