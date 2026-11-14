import { describe, expect, test } from 'vitest';
import { adminClanDissolveSchema, adminClanEditSchema, adminClanMemberSchema, adminClanQuerySchema, adminClanTagParamSchema, API_ERROR_CODES, modAuthorHideSchema, modChannelQuerySchema, modHideManySchema, modMuteSchema, modReasonSchema, modResolveSchema } from '../src/index';

// Moderation (GDD §16.4; M6c-1): what a moderator or an admin may send about chats, reports, mutes and clans. Every
// change carries a reason; dissolving a clan also carries the admin's password.

const clan = '0f8f0d0e-6c1b-4c39-9a37-1f7b0c4c2a11';

describe('chats', () => {
  test('un canal es todos, el global o el de un clan por su id, con un cursor opcional', () => {
    expect(modChannelQuerySchema.parse({})).toEqual({ channel: 'all', state: 'all' });
    expect(modChannelQuerySchema.parse({ channel: 'global' })).toEqual({ channel: 'global', state: 'all' });
    expect(modChannelQuerySchema.parse({ channel: `clan:${clan}`, before: '120' })).toEqual({ channel: `clan:${clan}`, state: 'all', before: '120' });
    expect(() => modChannelQuerySchema.parse({ channel: 'clan:GX' })).toThrow();
    expect(() => modChannelQuerySchema.parse({ channel: 'global', before: 'abc' })).toThrow();
  });

  // The owner's chat asks (2026-11-14): searching every chat at once.
  test('la búsqueda: texto de 3 letras o más, una cuenta, un estado, solo denunciados y fechas', () => {
    expect(modChannelQuerySchema.parse({ q: ' insulto ', author: 'Vega', state: 'hidden', reported: '1', from: '2026-11-14T00:00:00.000Z' })).toEqual({
      channel: 'all',
      q: 'insulto',
      author: 'vega',
      state: 'hidden',
      reported: '1',
      from: '2026-11-14T00:00:00.000Z',
    });
    expect(() => modChannelQuerySchema.parse({ q: 'ab' })).toThrow();
    expect(() => modChannelQuerySchema.parse({ state: 'borrados' })).toThrow();
    expect(() => modChannelQuerySchema.parse({ reported: 'si' })).toThrow();
  });

  test('ocultar varios: de 1 a 100 con motivo; lo último de una cuenta: 1, 24 o 168 horas', () => {
    expect(modHideManySchema.parse({ ids: ['1', '2'], reason: 'Spam' })).toEqual({ ids: ['1', '2'], reason: 'Spam' });
    expect(() => modHideManySchema.parse({ ids: [], reason: 'Spam' })).toThrow();
    expect(() => modHideManySchema.parse({ ids: Array.from({ length: 101 }, (_, i) => String(i + 1)), reason: 'Spam' })).toThrow();
    expect(modAuthorHideSchema.parse({ hours: 24, reason: 'Spam' })).toEqual({ hours: 24, reason: 'Spam' });
    expect(() => modAuthorHideSchema.parse({ hours: 2, reason: 'Spam' })).toThrow();
  });

  test('ocultar y restaurar piden un motivo de 3 a 300 caracteres', () => {
    expect(modReasonSchema.parse({ reason: '  Insultos  ' })).toEqual({ reason: 'Insultos' });
    expect(() => modReasonSchema.parse({ reason: 'no' })).toThrow();
    expect(() => modReasonSchema.parse({ reason: 'x'.repeat(301) })).toThrow();
  });

  test('una denuncia se resuelve ocultando o dejando visible, con motivo', () => {
    expect(modResolveSchema.parse({ outcome: 'kept', reason: 'No es ofensivo' })).toEqual({ outcome: 'kept', reason: 'No es ofensivo' });
    expect(modResolveSchema.parse({ outcome: 'hidden', reason: 'Spam' }).outcome).toBe('hidden');
    expect(() => modResolveSchema.parse({ outcome: 'deleted', reason: 'Spam' })).toThrow();
    expect(() => modResolveSchema.parse({ outcome: 'kept' })).toThrow();
  });

  test('un silencio dura de 1 minuto a 30 días y su motivo cabe en 140 caracteres', () => {
    expect(modMuteSchema.parse({ username: 'vega', minutes: 60, reason: 'Insultos' })).toEqual({ username: 'vega', minutes: 60, reason: 'Insultos' });
    expect(modMuteSchema.parse({ username: 'vega', minutes: 43_200, reason: 'Reincide' }).minutes).toBe(43_200);
    expect(() => modMuteSchema.parse({ username: 'vega', minutes: 0, reason: 'Insultos' })).toThrow();
    expect(() => modMuteSchema.parse({ username: 'vega', minutes: 43_201, reason: 'Insultos' })).toThrow();
    expect(() => modMuteSchema.parse({ username: 'vega', minutes: 60, reason: 'x'.repeat(141) })).toThrow();
  });
});

describe('clanes', () => {
  test('buscar acepta un texto vacío (los más nuevos) o de hasta 64 caracteres', () => {
    expect(adminClanQuerySchema.parse({})).toEqual({});
    expect(adminClanQuerySchema.parse({ q: 'gal' })).toEqual({ q: 'gal' });
    expect(() => adminClanQuerySchema.parse({ q: 'x'.repeat(65) })).toThrow();
  });

  test('la etiqueta de la ruta se lee en mayúsculas', () => {
    expect(adminClanTagParamSchema.parse({ tag: 'gx' })).toEqual({ tag: 'GX' });
    expect(() => adminClanTagParamSchema.parse({ tag: 'G' })).toThrow();
  });

  test('editar cambia nombre, etiqueta o descripción, al menos uno, con las reglas de los clanes', () => {
    expect(adminClanEditSchema.parse({ name: 'Nueva Era', reason: 'Nombre ofensivo' })).toEqual({ name: 'Nueva Era', reason: 'Nombre ofensivo' });
    expect(adminClanEditSchema.parse({ tag: 'ne', reason: 'Etiqueta ofensiva' }).tag).toBe('NE');
    expect(adminClanEditSchema.parse({ description: '', reason: 'Descripción ofensiva' }).description).toBe('');
    expect(() => adminClanEditSchema.parse({ reason: 'Nada que cambiar' })).toThrow();
    expect(() => adminClanEditSchema.parse({ name: 'ab', reason: 'Corto' })).toThrow();
    expect(() => adminClanEditSchema.parse({ tag: 'G!', reason: 'Etiqueta' })).toThrow();
  });

  test('expulsar y traspasar nombran a un miembro; disolver pide la contraseña', () => {
    expect(adminClanMemberSchema.parse({ username: 'vega', reason: 'Expulsado por trampas' })).toEqual({ username: 'vega', reason: 'Expulsado por trampas' });
    expect(() => adminClanMemberSchema.parse({ username: 'vega' })).toThrow();
    expect(adminClanDissolveSchema.parse({ reason: 'Clan de trampas', password: 'x' })).toEqual({ reason: 'Clan de trampas', password: 'x' });
    expect(() => adminClanDissolveSchema.parse({ reason: 'Clan de trampas' })).toThrow();
  });
});

test('los errores nuevos de moderación existen', () => {
  for (const code of ['report_reviewed', 'message_hidden', 'message_visible', 'mute_not_found'] as const) expect(API_ERROR_CODES).toContain(code);
});
