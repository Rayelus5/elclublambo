import { z } from 'zod';

// The player's settings on the account (plan «ajustes en la cuenta»): what Ajustes holds — sound, image,
// accessibility, the game — plus the last release note seen, kept with the account so every device shows the same.
// Every field is optional (a later client may know fields an older one does not); each is checked here, and anything
// unknown is dropped. The browser keeps a copy and applies these over it once signed in.

export const SETTINGS_MOTIONS = ['system', 'reduced', 'full'] as const;
export const SETTINGS_COLOR_VISIONS = ['none', 'protan', 'deutan', 'tritan'] as const;
export const SETTINGS_CURSOR_SIZES = ['small', 'medium', 'large'] as const;

const unit = z.number().min(0).max(1);

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
  /** The highest release note («Notas de versión») the player has opened, e.g. `1.4`. */
  notesSeen: z.string().regex(/^\d{1,3}\.\d{1,3}$/).nullable().optional(),
});

export type AccountSettings = z.infer<typeof accountSettingsSchema>;

/** GET and PUT /galaxy/api/settings: nothing (null) until the first save. */
export interface SettingsView {
  settings: AccountSettings | null;
  updatedAt: string | null;
}
