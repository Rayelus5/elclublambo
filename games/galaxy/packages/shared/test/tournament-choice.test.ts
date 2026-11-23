import { describe, expect, test } from 'vitest';
import { choiceGifts, choiceNeedsPick, choiceUnavailable, hasPrizeToCollect, parseConfig, type PrizeChoice, resolvePrizeChoice, SKIN_PROBES, type TournamentRewards } from '../src';

// The skins a tournament's place lets its winner choose (plan «Torneo Navideño», C1; GDD §13.3): what is given on its own,
// when the winner has to pick, what a pick that does not fit gets, and the signals for each skin that cannot be given
// (already owned, or switched off since).

const NAVIDAD = SKIN_PROBES.map((p) => `skin-${p}-navidad`);
const choice = (count: number, over: Partial<PrizeChoice> = {}): PrizeChoice => ({ piece: 'skin', options: NAVIDAD, count, perMissing: { currency: 'signal', amount: 10 }, ...over });
const none = { owned: [], unavailable: [] };
const owning = (...ids: string[]) => ({ owned: ids, unavailable: [] });

describe('resolver la elección', () => {
  test('el 1.º que ya tiene 3 del pack recibe las 5 que le faltan y 30 señales', () => {
    expect(resolvePrizeChoice(choice(8), owning(NAVIDAD[0]!, NAVIDAD[4]!, NAVIDAD[7]!))).toEqual({
      skins: [NAVIDAD[1], NAVIDAD[2], NAVIDAD[3], NAVIDAD[5], NAVIDAD[6]],
      missing: 3,
      compensation: { currency: 'signal', amount: 30 },
    });
    expect(choiceNeedsPick(choice(8), owning(NAVIDAD[0]!))).toBe(false);
  });

  test('el 2.º que no tiene ninguna tiene que elegir 3', () => {
    expect(choiceNeedsPick(choice(3), none)).toBe(true);
    expect(choiceNeedsPick(choice(3))).toBe(true);
    expect(resolvePrizeChoice(choice(3), none)).toEqual({ error: 'tournament_choice_invalid' });
    // The skins come back in the options' order, whatever the pick's.
    expect(resolvePrizeChoice(choice(3), none, [NAVIDAD[6]!, NAVIDAD[1]!, NAVIDAD[2]!])).toEqual({ skins: [NAVIDAD[1], NAVIDAD[2], NAVIDAD[6]], missing: 0, compensation: null });
  });

  test('al 2.º que solo le quedan 2 se le dan esas 2 y 10 señales por la que falta', () => {
    const blocked = owning(...NAVIDAD.slice(0, 6));
    expect(choiceNeedsPick(choice(3), blocked)).toBe(false);
    expect(resolvePrizeChoice(choice(3), blocked)).toEqual({ skins: [NAVIDAD[6], NAVIDAD[7]], missing: 1, compensation: { currency: 'signal', amount: 10 } });
  });

  test('el 3.º que ya las tiene todas cobra 10 señales y ninguna skin', () => {
    expect(resolvePrizeChoice(choice(1), owning(...NAVIDAD))).toEqual({ skins: [], missing: 1, compensation: { currency: 'signal', amount: 10 } });
  });

  test('elegir una que ya tienes es tournament_choice_owned', () => {
    expect(resolvePrizeChoice(choice(3), owning(NAVIDAD[2]!), [NAVIDAD[0]!, NAVIDAD[1]!, NAVIDAD[2]!])).toEqual({ error: 'tournament_choice_owned' });
  });

  test('un número equivocado, repetidas, una que no es opción o una que ya no está son tournament_choice_invalid', () => {
    const invalid = { error: 'tournament_choice_invalid' };
    expect(resolvePrizeChoice(choice(3), none, [NAVIDAD[0]!, NAVIDAD[1]!])).toEqual(invalid);
    expect(resolvePrizeChoice(choice(3), none, [NAVIDAD[0]!, NAVIDAD[1]!, NAVIDAD[2]!, NAVIDAD[3]!])).toEqual(invalid);
    expect(resolvePrizeChoice(choice(3), none, [NAVIDAD[0]!, NAVIDAD[0]!, NAVIDAD[1]!])).toEqual(invalid);
    expect(resolvePrizeChoice(choice(3), none, [NAVIDAD[0]!, NAVIDAD[1]!, 'skin-lumen-fuego'])).toEqual(invalid);
    expect(resolvePrizeChoice(choice(3), { owned: [], unavailable: [NAVIDAD[5]!] }, [NAVIDAD[0]!, NAVIDAD[1]!, NAVIDAD[5]!])).toEqual(invalid);
    expect(resolvePrizeChoice(choice(3), none, [])).toEqual(invalid);
  });

  test('una elección cuando no hay que elegir se ignora', () => {
    const blocked = owning(...NAVIDAD.slice(0, 6));
    expect(resolvePrizeChoice(choice(3), blocked, [NAVIDAD[0]!, 'skin-lumen-fuego'])).toEqual({ skins: [NAVIDAD[6], NAVIDAD[7]], missing: 1, compensation: { currency: 'signal', amount: 10 } });
    expect(resolvePrizeChoice(choice(8), none, [NAVIDAD[0]!])).toEqual({ skins: NAVIDAD, missing: 0, compensation: null });
  });

  test('sin compensación no se cobra nada por las que faltan', () => {
    expect(resolvePrizeChoice(choice(8, { perMissing: null }), owning(NAVIDAD[0]!))).toEqual({ skins: NAVIDAD.slice(1), missing: 1, compensation: null });
  });

  test('una opción desactivada cuenta como que falta', () => {
    const blocked = { owned: [NAVIDAD[0]!], unavailable: [NAVIDAD[1]!] };
    expect(resolvePrizeChoice(choice(8), blocked)).toEqual({ skins: NAVIDAD.slice(2), missing: 2, compensation: { currency: 'signal', amount: 20 } });
    expect(choiceNeedsPick(choice(6), blocked)).toBe(false);
    expect(choiceNeedsPick(choice(5), blocked)).toBe(true);
  });
});

describe('lo que rodea a la elección', () => {
  test('las opciones que ya no se pueden dar: desactivadas o fuera del catálogo vivo', () => {
    const cosmetics = parseConfig('cosmetics', {});
    expect(choiceUnavailable(NAVIDAD, cosmetics)).toEqual([]);
    const off = { ...cosmetics, skins: cosmetics.skins.filter((s) => s.id !== NAVIDAD[2]).map((s) => (s.id === NAVIDAD[5] ? { ...s, enabled: false } : s)) };
    expect(choiceUnavailable(NAVIDAD, off)).toEqual([NAVIDAD[2], NAVIDAD[5]]);
  });

  test('cada opción pesa como un regalo cosmético', () => {
    expect(choiceGifts(choice(1, { options: [NAVIDAD[0]!, NAVIDAD[1]!] }))).toEqual([
      { kind: 'cosmetic', piece: 'skin', id: NAVIDAD[0] },
      { kind: 'cosmetic', piece: 'skin', id: NAVIDAD[1] },
    ]);
  });

  test('hay premio que recoger con regalos o con skins a elegir, nunca con solo dinero', () => {
    const base: TournamentRewards = { place: 1, gifts: [], cash: null, participation: false };
    expect(hasPrizeToCollect(null)).toBe(false);
    expect(hasPrizeToCollect(undefined)).toBe(false);
    expect(hasPrizeToCollect(base)).toBe(false);
    expect(hasPrizeToCollect({ ...base, cash: { amountEur: 20, note: '' } })).toBe(false);
    expect(hasPrizeToCollect({ ...base, gifts: [{ kind: 'xp', amount: 5 }] })).toBe(true);
    expect(hasPrizeToCollect({ ...base, choice: choice(1) })).toBe(true);
  });
});
