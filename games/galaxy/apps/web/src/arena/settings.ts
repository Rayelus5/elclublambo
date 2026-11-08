// Per-player arena settings kept in localStorage (a convenience: missing storage just means the defaults).
const AIM_KEY = 'galaxy.aim.manual';
const RADIO_KEY = 'galaxy.radio.seen';

export function manualAim(): boolean {
  try {
    return localStorage.getItem(AIM_KEY) === '1';
  } catch {
    return false;
  }
}

export function setManualAim(on: boolean): void {
  try {
    localStorage.setItem(AIM_KEY, on ? '1' : '0');
  } catch {
    // Private windows: this page only.
  }
}

/** PERKINS says each key line once per player (GDD §15: short, skippable, never twice). */
export function radioSeen(id: string): boolean {
  try {
    return (localStorage.getItem(RADIO_KEY) ?? '').split(',').includes(id);
  } catch {
    return false;
  }
}

/** Forgets every line heard, so PERKINS says them again (Ajustes, M8a). */
export function resetRadio(): void {
  try {
    localStorage.removeItem(RADIO_KEY);
  } catch {
    // Private windows: nothing kept anyway.
  }
}

export function markRadioSeen(id: string): void {
  try {
    const list = (localStorage.getItem(RADIO_KEY) ?? '').split(',').filter(Boolean);
    if (!list.includes(id)) localStorage.setItem(RADIO_KEY, [...list, id].join(','));
  } catch {
    // Private windows: this page only.
  }
}
