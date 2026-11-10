# Referencia: reliquias

Rutas relativas a `games/galaxy/`.

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Rasgos a poder (`relicSkill`), familias, fenómenos, cuásar, doble núcleo | `packages/sim/src/systems/relics.ts` (`TYPE_FAMILY`, `SHAPE`, `runFamily`, `runPhenomenon`, `runQuasar`, `relicBonuses`, `relicPersistent`, `relicVision`) |
| Conjuntos | `packages/sim/src/systems/sets.ts` (`activeSets`, `possibleSets`) |
| Bonos a stats | `packages/sim/src/systems/stats.ts` (`relicHooks.bonuses`) |
| Recarga del escudo | `packages/sim/src/systems/probes.ts` |
| Probabilidad elemental en armas | `packages/sim/src/systems/elements.ts` (`weaponProc`) |
| Esquema | `packages/sim/src/content/schema.ts` (`setBonus`, `relicSet`, `relics`, comprobación `sets()`) |
| Tipos | `packages/sim/src/content/types.ts` (`FAMILY_IDS`, `PHENOMENON_IDS`, `SetBonus`, `RelicSetDef`, `RelicTuning`) |
| Datos | `packages/sim/src/content/default.ts`, bloque `relics`; paletas en `elements.palettes` |
| Valores de rasgo | `packages/engine/config/traits.yaml` (regenera con `pnpm -C packages/engine gen:config`) |
| Hangar | `apps/web/src/hangar/SkillTags.tsx` (la ficha), `hangar/lobby/RelicStrip.tsx` (cartas, «Potencia ×», apilado), `hangar/SetsPanel.tsx` (conjuntos, `bonusLines`) |
| Textos | `apps/web/src/copy/es.ts` › `copy.hangar`: `families`, `elements`, `phenomena`, `skillInfo`, `setBonus`, `setMissing`, `stacking`, `power` |
| Niveles y ranuras | clave viva `relics` en `packages/shared/src/config/registry.ts`; `packages/shared/src/relics/progress.ts` (`relicLevelCost`, `relicRefund`, `nextSlot`); formulario en `apps/web/src/admin/forms/labels.ts` |

## Tests

| Test | Qué fija |
|---|---|
| `packages/sim/test/relics.test.ts` | Valores literales: magnitud 2 / 1,15 / 0,85, frecuencia 1,3, nivel 1,04, eco 0,8, escudo 24 cada 5 s, lente 1,8, explorador ×1,29 / ×1,07, aura 3×5, caos cada 4 s, cuásar cada 3 s, supernova 40/120/8 s, púlsar 8/70/1,2 s, cometa 90/30, cúmulo 4 orbes… Varios nombres de test llevan el número |
| `packages/sim/test/sets.test.ts` | 0,25 / 0,5, ×1,15, ×1,5, 0,08; aserciones exactas como `toEqual(['lineage'])` |
| `packages/sim/test/stats.test.ts`, `calibration.test.ts`, `builds.test.ts`, `golden.test.ts` | Bonos a stats, topes del GDD §8.6 y partidas de referencia (sin reliquias) |
| `packages/sim/test/content.test.ts` | Casos del esquema de conjuntos |
| `packages/shared/test/relics-progress.test.ts` | Costes y ranuras |
| `apps/server/test/integration/relics.test.ts`, `hangar.test.ts` | Servidor (los pasa CI) |
| `apps/web/test/hangar.test.tsx` | Conjuntos de reliquias, apilado y la ficha de habilidades (aserción de 4 filas) |
| `apps/web/test/admin-forms.test.ts` | Formulario de la clave `relics` |

## Huecos conocidos

Mejoras posibles, que se proponen al propietario y no se hacen por iniciativa propia:
- El bono de fondo no se ve en el Hangar (no tiene etiqueta).
- `copy.hangar.stacking` lleva el apilado escrito a mano.
- La «resistencia a la Estática» del GDD no está implementada.
- Un bono negativo en un conjunto se leería «+-5 %».

## GDD

- §8.2: multiplicadores por rareza [U].
- §8.3: tabla de rasgos a poderes [D].
- §8.4: ranuras [U].
- §8.4 bis: niveles [D].
- §8.6: frenos, comprobados por la calibración en CI.
- `DESIGN_SYSTEM.md` §8 ter (conjuntos) y §8 nonies (niveles).

## Ejemplo

8aab2c65 añadió los conjuntos, sin subir `SIM_VERSION`: código nuevo que solo alcanzan datos nuevos.
