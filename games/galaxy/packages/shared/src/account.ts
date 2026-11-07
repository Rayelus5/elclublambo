import { z } from 'zod';

/** Usuario (GDD §18.2): `^[a-z0-9_]{3,20}$` sin distinguir mayúsculas; siempre se guarda en minúsculas. */
export const usernameSchema = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_]{3,20}$/));

/** Contraseña: de 10 a 128 caracteres (el máximo acota el coste de argon2). */
export const passwordSchema = z.string().min(10).max(128);

export const registerInput = z
  .object({ username: usernameSchema, password: passwordSchema })
  .refine((v) => v.password.toLowerCase() !== v.username, { path: ['password'], message: 'password_equals_username' });

/** En el login la contraseña solo se acota por arriba: una corta es simplemente incorrecta. */
export const loginInput = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });

export const totpInput = z.object({
  challenge: z.string().min(1).max(200),
  code: z.string().regex(/^\d{6}$/),
});

export const resetRedeemInput = z
  .object({
    username: usernameSchema,
    code: z.string().min(1).max(64),
    newPassword: passwordSchema,
  })
  .refine((v) => v.newPassword.toLowerCase() !== v.username, { path: ['newPassword'], message: 'password_equals_username' });

export type Role = 'superadmin' | 'admin' | 'moderator';
export const ROLES: readonly Role[] = ['superadmin', 'admin', 'moderator'];

/** `level`: the account level (M5a), sent by `/auth/me`; the sign-in answers leave it out. */
export type MeResponse = { id: string; username: string; roles: Role[]; mfa: boolean; level?: number };

export type LoginResponse = { status: 'ok'; me: MeResponse } | { status: 'totp_required'; challenge: string };
