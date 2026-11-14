// How long a dropped socket waits before coming back: 1, 2, 4… seconds, 30 at most (the live socket and the group
// run's use it). The chats themselves arrive on the live socket since the owner's chat asks (2026-11-14).
export const retryDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
