---
name: galaxy-reliquias
description: Crear o cambiar las pasivas de las galaxias equipadas como reliquias en Galaxy Survivor. Cubre retocar su potencia (familias, fenómenos, factores por rareza, tamaño, núcleo o densidad, apilado, cuásar, doble núcleo), añadir conjuntos, cambiar bonos de fondo, dar un efecto nuevo a un fenómeno o una familia, y ajustar niveles y ranuras de reliquia. Úsala cuando pidan «reliquias», «pasivas de galaxias», «poderes de las galaxias», «conjunto», «familia», «fenómeno», «potencia», «apilado» o «ranuras», o relics, galaxy passives, relic sets.
---

# Reliquias: los poderes de las galaxias

Cuando un jugador equipa una galaxia en una ranura, sus **rasgos** se convierten en **poderes** dentro de la incursión. Todo lo que hacen está en `packages/sim/src/systems/relics.ts` (`relicSkill`, `updateRelics`, `relicBonuses`):

| Rasgo | Poder |
|---|---|
| Tipo | La familia (`TYPE_FAMILY`): `blades, ray, shield, lens, chaos, aura, scout, echo` |
| Brazos | El número |
| Inclinación | La forma |
| Paleta | El elemento (está en `content.elements.palettes`) |
| Fenómeno | Una habilidad única |
| Fondo | Un bono |
| Rareza, tamaño, núcleo y nivel | La potencia |
| Densidad | La frecuencia |

Los conjuntos (`systems/sets.ts`) dan bonos por llevar varias galaxias que comparten un rasgo.

Antes de empezar, lee `games/galaxy/AGENTS.md`, la parte A de `games/galaxy/docs/CONTENIDO.md` y el GDD §8.2–8.6. Cada sitio que hay que tocar está en `referencia.md`. Las rutas son relativas a `games/galaxy/`. Donde dice AskUserQuestion, si no eres Claude, pregunta al propietario con opciones.

## 1. Clasifica el cambio y pregunta

| Cambio | Tipo | Riesgo |
|---|---|---|
| Retocar números (`content.relics`: `tier`, `level`, `stacking`, factores `size`/`core`/`density`, `families.*`, `phenomena.*`, `quasar`, `double`, `weaponProc`, valor de un fondo) | Datos | Bajo |
| Elemento de una paleta | Datos (`content.elements.palettes`) | Bajo |
| Conjunto nuevo `same` (paleta, tipo, fondo o núcleo) o `combo` (tipo + fenómeno), con bono de `stats`/`magnitude`/`background` | Datos, más el texto del bono si usa una stat sin texto | Bajo |
| Tipo de conjunto o de bono nuevo | Código | Medio |
| Efecto nuevo de un fenómeno o familia existente | Código, sube `SIM_VERSION` | Medio |
| Fondo con un efecto que no es una stat | Código | Medio |
| Coste de niveles, devolución, condiciones y precios de ranuras | Datos de la clave viva `relics` (no de `content`) | Bajo |
| **Valor de rasgo nuevo** (fenómeno, fondo, tipo de galaxia, paleta) | Motor: `ENGINE_VERSION` 2; cambia las galaxias que ya tienen los jugadores | **Para** |
| **Cambiar qué familia da un tipo (`TYPE_FAMILY`)** | Cambia lo que hace cada galaxia ya obtenida | **Para** |
| **Tocar GDD §8.2 (multiplicadores por rareza) o §8.4 (ranuras)** | Son [U] | **Para** |

**Para:** no lo implementes. Escribe una propuesta breve (qué cambia, a quién afecta, coste) y pregúntale al propietario.

**En todos los casos**, confirma con AskUserQuestion los nombres (en español, sin punto final) y los números de partida antes de tocar nada.

## 2. Siempre en `DEFAULT_CONTENT` y además publicado

El Hangar describe las reliquias con el contenido incluido en la web (`RelicStrip.tsx`, `SetsPanel.tsx`), y la incursión usa el publicado. Un cambio que solo se publica deja el Hangar mintiendo, y uno que solo se programa no llega a PRE. Por eso cada cambio de `content.relics` lleva:
1. `DEFAULT_CONTENT` (`packages/sim/src/content/default.ts`, bloque `relics`);
2. PR y despliegue;
3. volver a publicar `{ "relics": … }` entero, partiendo de lo vivo.

## 3. Pasos según el cambio

**Retoque:**
1. Cambia los números en `default.ts`, dentro de los límites del esquema (`schema.ts`, `relics`).
2. Actualiza los textos con números escritos: `copy.hangar.stacking` en `es.ts`, `docs/DESIGN_SYSTEM.md`, GDD §8.4 bis.
3. Actualiza los tests con valores literales (`relics.test.ts`, `sets.test.ts`).

**Conjunto nuevo:**
1. Añádelo a `relics.sets`: id permanente y único, `tiers` de 2 o 3 piezas, nombre ≤60, descripción ≤200.
2. Copia los valores de rasgo de `packages/engine/config/traits.yaml` y respeta sus reglas `forbid`/`force`. Una errata no da error: el conjunto nunca se activa.
3. Si el bono usa una stat sin texto en `copy.hangar.setBonus.stat` (`es.ts`), añádelo. Si no, se ve la clave en crudo.
4. Test de activación en `sets.test.ts`. Revisa las aserciones exactas existentes, que pueden romperse si el conjunto nuevo se solapa.

**Efecto nuevo de fenómeno o familia:**
1. Cambia `relics.ts` (`runPhenomenon`, `runFamily`, `relicBonuses`…).
2. Parámetros nuevos con `.default(x)` en `schema.ts`, en `types.ts` y en `DEFAULT_CONTENT`.
3. Si hay un disparo o área nuevos, ver la skill `galaxy-habilidad`.
4. Textos en `copy.hangar.skillInfo` y en los mapas `families`/`phenomena` de `es.ts`.
5. GDD §8.3.
6. Sube `SIM_VERSION`.

**Niveles y ranuras:** clave viva `relics` (`packages/shared/src/config/registry.ts`):
- `levels`: 9 costes, de nivel 2 a 10;
- `refund`;
- `slots`: hasta 4 extra, con condición y coste.

No hace falta desplegar: se publica `relics` (la clave) con `galaxy-publicar-config`. Ojo, es distinta de `content.relics`.

## 4. Tests y verificación

Primero el test que falla. Después:
```
pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/relics.test.ts packages/sim/test/sets.test.ts packages/sim/test/stats.test.ts packages/sim/test/calibration.test.ts packages/sim/test/builds.test.ts packages/sim/test/golden.test.ts
pnpm -C games/galaxy exec vitest run --project web apps/web/test/hangar.test.tsx
pnpm -C games/galaxy typecheck && pnpm -C games/galaxy lint
```
- **Calibración:** las reliquias son el principal riesgo de combinaciones rotas (GDD §8.6). Para cambios grandes, `GALAXY_CALIBRATE=1`.
- **Referencia:** los goldens juegan sin reliquias, así que casi nunca se mueven, pero confírmalo.
- **Hangar:** mira la ficha de habilidades de la reliquia, «Potencia ×» y el panel de conjuntos (capturas con `VITE_ARENA_SHOTS=1` en `hangar.browser.test.ts`).

## 5. Entrega y publicación

1. Rama `feature/galaxy-reliquias-<slug>` desde `develop`, PR con «Qué cambia» y «Pruebas», CI en verde, merge y despliegue en PRE.
2. Con el código desplegado, en una rama nueva, crea `ops/launch/<aaaa-mm-dd>-<slug>/`:
   - `content.json`: `ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js draft-config content relics" > …/content.json` (o `elements`). Como `relics` no es una lista con ids, sale entero del código: si el propietario retocó reliquias desde el panel, `check-config` lo mostrará como cambio y habrá que decidir con él;
   - o `relics.json`, para niveles y ranuras (`show-config relics --data` más tu cambio);
   - y su `LEEME.md`.
   Si no puedes llegar a PRE, para y pide al propietario la salida de esos comandos.
3. Pasa `launch-config.test.ts`.
4. Usa la skill `galaxy-publicar-config`, que pide el OK del propietario.
