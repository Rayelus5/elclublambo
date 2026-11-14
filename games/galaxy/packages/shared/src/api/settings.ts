import { z } from 'zod';

// The player's settings on the account (plan «ajustes en la cuenta»): what Ajustes holds — sound, image,
// accessibility, the game — plus the last release note seen, kept with the account so every device shows the same.
// Every field is optional (a later client may know fields an older one does not); each is checked here, and anything
// unknown is dropped. The browser keeps a copy and applies these over it once signed in.

export const SETTINGS_MOTIONS = ['system', 'reduced', 'full'] as const;
export const SETTINGS_COLOR_VISIONS = ['none', 'protan', 'deutan', 'tritan'] as const;
export const SETTINGS_CURSOR_SIZES = ['small', 'medium', 'large'] as const;
/** The soundtrack's styles (plan «banda sonora»), and «Mi música» (the owner's own files). */
export const SETTINGS_MUSIC_STYLES = ['ambient', 'lofi', 'synthwave', 'own'] as const;
export type MusicStyleChoice = (typeof SETTINGS_MUSIC_STYLES)[number];

const unit = z.number().min(0).max(1);

/**
 * The run's rebindable actions (the owner, 2026-11-14) and what a slot may hold: a key's `KeyboardEvent.code` or a
 * mouse button (`Mouse0`–`Mouse4`). Aiming and the zoom are fixed, and Escape always pauses.
 */
export const KEYBIND_ACTIONS = ['up', 'down', 'left', 'right', 'dash', 'pick1', 'pick2', 'pick3', 'confirm', 'pause', 'mark'] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];
export const KEYBIND_CODE = /^(?:Mouse[0-4]|[A-Za-z][A-Za-z0-9]{1,23})$/;
const slot = z.string().regex(KEYBIND_CODE).nullable();

export const accountSettingsSchema = z.object({
  v: z.literal(1),
  scannerPro: z.boolean().optional(),
  motion: z.enum(SETTINGS_MOTIONS).optional(),
  colorVision: z.enum(SETTINGS_COLOR_VISIONS).optional(),
  music: unit.optional(),
  sfx: unit.optional(),
  muted: z.boolean().optional(),
  ui: z.boolean().optional(),
  cursor: z.boolean().optional(),
  cursorSize: z.enum(SETTINGS_CURSOR_SIZES).optional(),
  cursorColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  manualAim: z.boolean().optional(),
  /** Accesibilidad: a soft white glow behind the player's probe in the runs. */
  probeGlow: z.boolean().optional(),
  musicStyle: z.enum(SETTINGS_MUSIC_STYLES).optional(),
  /** The run's controls: two slots per action (a key or a mouse button, or none). Each device checks them again. */
  keybinds: z.partialRecord(z.enum(KEYBIND_ACTIONS), z.tuple([slot, slot])).optional(),
  /** Which chats tell me with a notice while I do not have them open (the owner, 2026-11-14). */
  chatNotify: z.object({ global: z.boolean(), clan: z.boolean(), room: z.boolean(), mentions: z.boolean() }).partial().strict().optional(),
  /** The highest release note («Notas de versión») the player has opened, e.g. `1.4`. */
  notesSeen: z.string().regex(/^\d{1,3}\.\d{1,3}$/).nullable().optional(),
});

export type AccountSettings = z.infer<typeof accountSettingsSchema>;

/** GET and PUT /galaxy/api/settings: nothing (null) until the first save. */
export interface SettingsView {
  settings: AccountSettings | null;
  updatedAt: string | null;
}
