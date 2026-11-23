# Torneo Navideño

El propietario lo pidió el 23/11: un torneo de diciembre que anime a jugar todo el mes. Las imágenes promocionales están en `~/Downloads/Galaxy Survivor - Temporada 2 y Torneo Navideño/` y en la rama `feature/galaxy-trailer`, que nunca se une.

| | |
|---|---|
| Slug | `torneo-navideno` (`/torneos/torneo-navideno`) |
| Fechas (Madrid) | Del 1/12 a las 00:00 al 31/12 a las 23:59. Son 31 días; el máximo pasó de 28 a 31 en esta misma tanda |
| Cómo se gana | `points`: los puntos de temporada de cada partida que se termina desde que uno se inscribe, sumados, en solitario o en grupo |
| Quién se inscribe | Desde el nivel 5. Exclusivo, sin entrada y sin cupo |
| 1.º | Pack Navidad completo (las 8 skins) y 30 señales |
| 2.º | Elige 3 skins del pack y 25 señales |
| 3.º | Elige 1 skin del pack y 20 señales |
| Puestos 4 al 10 | 15 señales |
| Puestos 11 al 100 | 10 señales |

**Si el ganador ya tiene skins del pack,** solo puede elegir entre las que no tiene. Por cada skin que no se le pueda dar, recibe 10 señales (`perMissing`). Es lo que decidió el propietario. Ejemplo: un 1.º que compró el pack recibe 30 + 80 señales.

**Lo programa un superadmin.** Lleva skins de tienda y más de 50 señales por jugador, así que sale `cosmetic_shop` y `currency_signal`.

## Archivos

- `torneo.json`: la ficha del torneo. Las imágenes no van aquí: se suben en el panel (`bannerMedia` y `detailsMedia` quedan en `null`).
- `temporada.json`: la ficha de la Temporada 2 con el final en **`2026-12-31T23:00:00.000Z`** (1/1 a las 00:00 de Madrid). Es igual a la de `2026-11-23-temporada-2` salvo esa fecha. Sirve para que `launch-config.test.ts` compruebe el torneo contra la temporada ya alargada. **No se publica con `season-import`:** la fecha se cambia en PRE con `season-extend` (paso 1).
- `avisos/promocion-torneo-navideno.json`: una campaña «Promoción» de Encuestas y avisos, del 1/12 al 8/12 a las 00:00, para nivel 3 o más, con la imagen `avisos/torneo-navideno.png` y el botón «Ver el torneo», que lleva a `/torneos`.

## Pasos en PRE (cada uno con el OK del propietario)

Necesitan desplegado el código de los premios a elegir: los PR de «skins a elegir» y de las pantallas.

1. **Alargar la Temporada 2 un día.**

   ```sh
   ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js season-extend season-2 2026-12-31T23:00:00.000Z --reason 'Torneo Navideño hasta fin de año'"
   ```

   Esto mueve también el cierre de la temporada a la noche del 31 al 1: los premios de cierre se entregan entonces, y las Esquirlas que sobren pasan a polvo entonces. No hay Temporada 3 programada, así que no hace falta `--move-next`. El evento Escuadrón estelar tiene sus propias fechas (hasta el 31/12 a las 00:00) y no cambia.

2. **Comprobar el torneo contra lo vivo,** que solo lee:

   ```sh
   node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/2026-12-01-torneo-navideno | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
   ```

   Tiene que decir «Torneo torneo-navideno: se puede guardar y programar».

3. **Guardarlo como borrador:**

   ```sh
   node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/2026-12-01-torneo-navideno | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js tournament-draft - --reason 'Torneo Navideño'"
   ```

4. **El propietario, en Administración › Torneos › el borrador:**
   - sube como banner `torneo-navideno-banner-1600x600.png` y como imagen de premios `torneo-navideno-premios-1600x900.png`, de la carpeta de Descargas;
   - mira «Así lo verá el jugador»;
   - pulsa «Guardar y programar» con su contraseña.

   Desde ese momento se puede inscribir cualquiera de nivel 5 o más, aunque solo cuentan las partidas desde el 1/12.

5. **La campaña de promoción** (opcional):

   ```sh
   node games/galaxy/scripts/popup-bundle.mjs games/galaxy/ops/launch/2026-12-01-torneo-navideno/avisos/promocion-torneo-navideno.json | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js popup-draft - --reason 'Promoción del Torneo Navideño'"
   ```

   Después, en Administración › Encuestas y avisos › el borrador › Revisión › «Guardar y publicar».

## Avisos

- La promoción de la Temporada 2 ya publicada dice «hasta el 30 de diciembre». Una campaña publicada no se puede editar; dice menos tiempo del que de verdad queda.
- Si durante diciembre se integra algo que suba `SIM_VERSION`, las partidas anteriores del torneo quedarán sin comprobar y habrá que decidirlas en bloque en la revisión. Hay que avisar antes al propietario.
