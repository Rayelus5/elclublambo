import { create } from 'zustand';

/** Global UI state that is not server data (TanStack Query owns that). */
type UiState = {
  /** Set when any API call answers 503 maintenance. */
  maintenance: boolean;
  setMaintenance: (on: boolean) => void;
};

export const useUi = create<UiState>((set) => ({
  maintenance: false,
  setMaintenance: (on) => set({ maintenance: on }),
}));
