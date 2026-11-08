import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, CLAN_COLORS, CLAN_EMBLEMS, canManage, clanCreateSchema, clanEditSchema, parseConfig, successor } from '../src/index';

// Clans (GDD §14.3; M5b-1): a name, a tag, an emblem and a colour; roles that decide who can do what; when the leader
// leaves, the oldest officer takes over, or the oldest member, or the clan is gone.

const valid = { name: 'Los Ñandúes 7', tag: 'nd7', description: '', emblem: 'comet', color: 'uv', open: true };

describe('crear un clan', () => {
  test('el nombre admite letras con tilde, ñ, cifras y espacios sueltos, de 3 a 24', () => {
    expect(clanCreateSchema.parse(valid)).toMatchObject({ name: 'Los Ñandúes 7', tag: 'ND7' });
    expect(clanCreateSchema.safeParse({ ...valid, name: 'Los  Ñandúes' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, name: ' Ñandúes' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, name: 'ab' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, name: 'a'.repeat(25) }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, name: 'Clan<script>' }).success).toBe(false);
    // Latin letters only (no look-alikes from other scripts) and 24 characters counted as characters.
    expect(clanCreateSchema.safeParse({ ...valid, name: 'Lоs Halcones' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, name: '𠀀𠀀𠀀' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, name: 'Ça Ñandú Øre 99' }).success).toBe(true);
  });

  test('la etiqueta es de 2 a 4 letras o cifras y se guarda en mayúsculas', () => {
    expect(clanCreateSchema.safeParse({ ...valid, tag: 'A' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, tag: 'ABCDE' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, tag: 'A-B' }).success).toBe(false);
    expect(clanCreateSchema.parse({ ...valid, tag: 'gx' }).tag).toBe('GX');
  });

  test('la descripción va hasta 140, y emblema y color son de los que hay', () => {
    expect(clanCreateSchema.safeParse({ ...valid, description: 'x'.repeat(141) }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, emblem: 'skull' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...valid, color: 'pink' }).success).toBe(false);
    expect(CLAN_EMBLEMS).toHaveLength(8);
    expect(CLAN_COLORS).toEqual(['solar', 'nova', 'terminal', 'ice', 'uv', 'coral']);
  });

  test('editar no cambia el nombre y todo es opcional', () => {
    expect(clanEditSchema.parse({ open: false })).toEqual({ open: false });
    expect(clanEditSchema.safeParse({ name: 'Otro' }).success).toBe(false);
  });

  test('la configuración trae 30 miembros, 2000 monedas y el nivel 5', () => {
    expect(parseConfig('clans', {})).toEqual({ maxMembers: 30, createCost: { coins: 2000 }, minLevel: 5, kickHours: 24 });
    expect(() => parseConfig('clans', { maxMembers: 2 })).toThrow();
  });
});

describe('los roles', () => {
  test('el líder puede con todo, menos consigo mismo', () => {
    expect(canManage('leader', 'officer', 'kick')).toBe(true);
    expect(canManage('leader', 'member', 'promote')).toBe(true);
    expect(canManage('leader', 'officer', 'demote')).toBe(true);
    expect(canManage('leader', 'member', 'transfer')).toBe(true);
    expect(canManage('leader', 'member', 'accept')).toBe(true);
    expect(canManage('leader', 'member', 'edit')).toBe(true);
    expect(canManage('leader', 'leader', 'kick')).toBe(false);
    expect(canManage('leader', 'leader', 'demote')).toBe(false);
    expect(canManage('leader', 'officer', 'promote')).toBe(false);
    expect(canManage('leader', 'member', 'demote')).toBe(false);
  });

  test('un oficial expulsa miembros y acepta solicitudes, nada más', () => {
    expect(canManage('officer', 'member', 'kick')).toBe(true);
    expect(canManage('officer', 'member', 'accept')).toBe(true);
    expect(canManage('officer', 'officer', 'kick')).toBe(false);
    expect(canManage('officer', 'leader', 'kick')).toBe(false);
    expect(canManage('officer', 'member', 'promote')).toBe(false);
    expect(canManage('officer', 'member', 'edit')).toBe(false);
    expect(canManage('officer', 'member', 'transfer')).toBe(false);
  });

  test('un miembro no puede con nada', () => {
    for (const action of ['kick', 'promote', 'demote', 'accept', 'edit', 'transfer'] as const) expect(canManage('member', 'member', action), action).toBe(false);
  });

  test('si se va el líder, manda el oficial más antiguo, luego el miembro más antiguo', () => {
    const at = (d: number) => `2026-11-0${d}T00:00:00.000Z`;
    expect(successor([{ role: 'member', joinedAt: at(1) }, { role: 'officer', joinedAt: at(5) }, { role: 'officer', joinedAt: at(3) }])).toBe(2);
    expect(successor([{ role: 'member', joinedAt: at(4) }, { role: 'member', joinedAt: at(2) }])).toBe(1);
    expect(successor([])).toBeNull();
  });
});

test('los errores nuevos existen', () => {
  for (const code of ['clan_full', 'clan_name_taken', 'clan_tag_taken', 'already_in_clan', 'not_in_clan', 'clan_not_found', 'clan_forbidden', 'clan_closed', 'request_not_found', 'clan_kicked', 'level_too_low'])
    expect(API_ERROR_CODES, code).toContain(code);
});
